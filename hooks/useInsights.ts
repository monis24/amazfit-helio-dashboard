/**
 * useInsights.ts — view model for the Local Insights Card: VO2 Max (Model A
 * + B, labeled separately), device-computed stress 7-day trend, and
 * estimated recovery time remaining (SPEC.md's Phase 3 section). Each
 * computation is surfaced as its own EngineResult rather than one combined
 * status, since e.g. Model B/HRR are expected to be 'insufficient-data'
 * today — this account has zero recorded workouts (SPEC.md's live blocker) —
 * while Model A and the stress trend can still succeed independently.
 */

import { useEffect, useState } from 'react';

import { getHrDaysInRange, getLatestSource, getMostRecentSleepSession } from '../db/queries/bandData';
import { getStressDaysInRange } from '../db/queries/events';
import { getSingletonUserProfile } from '../db/queries/userProfile';
import { hasAnyWorkout } from '../db/queries/workouts';
import { hrDayRowToMapping, mapHrDaysToSamplesInRange } from '../db/mappers/hrBlobMapper';
import { ageFromBirthday } from '../types/ZeppApiSchemas';
import {
  computeRestingHr,
  gellishHrMax,
  vo2MaxModelA as computeVo2MaxModelA,
  type EngineResult,
  type HrrResult,
} from '../engines/BiometricEngine';
import { stressSevenDayTrend, type StressTrendResult } from '../engines/StressTrendEngine';
import type { SqliteDatabase } from '../db/Database';
import { useDatabase } from './DatabaseContext';
import { paddedLocalDateRange, todayLocalDate } from './localDateRange';
import { errorState, LOADING, type HookState } from './asyncState';

/** SPEC.md's Model A: "final 120 minutes of sleep." Padded so the fetched
 *  HR range comfortably covers computeRestingHr's own search window. */
const RESTING_HR_SEARCH_MINUTES = 120;
const RESTING_HR_FETCH_PAD_MINUTES = 30;
const STRESS_TREND_WINDOW_DAYS = 7;

export interface Vo2ModelAResult {
  readonly vo2Max: number;
  readonly hrRest: number;
}

export interface InsightsViewModel {
  readonly vo2MaxModelA: EngineResult<Vo2ModelAResult>;
  /** Model B is EngineResult<never>-shaped 'insufficient-data' until a real
   *  workout exists — see hasAnyWorkout's doc comment for why this hook
   *  can't attempt Model B at all today, not just "hasn't found one yet." */
  readonly vo2MaxModelB: EngineResult<never>;
  readonly stressTrend: EngineResult<StressTrendResult>;
  readonly hrr: EngineResult<HrrResult>;
}

const NO_WORKOUTS_RECORDED: EngineResult<never> = {
  kind: 'insufficient-data',
  reason: 'no-workouts-recorded: this account has no recorded workouts yet (SPEC.md live blocker)',
};

export function useInsights(): HookState<InsightsViewModel> {
  const db = useDatabase();
  const [state, setState] = useState<HookState<InsightsViewModel>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);

    void (async () => {
      try {
        const source = await getLatestSource(db);
        if (source === null) {
          if (!cancelled) {
            setState({
              status: 'ready',
              data: {
                vo2MaxModelA: { kind: 'insufficient-data', reason: 'no data synced yet' },
                vo2MaxModelB: NO_WORKOUTS_RECORDED,
                stressTrend: { kind: 'insufficient-data', reason: 'no data synced yet' },
                hrr: NO_WORKOUTS_RECORDED,
              },
            });
          }
          return;
        }

        const workoutExists = await hasAnyWorkout(db);
        const vo2MaxModelB = workoutExists
          ? ({
              kind: 'insufficient-data',
              reason: 'workout-stream-decoding-unimplemented: workout_details wire shape is unverified (SPEC.md live blocker)',
            } as const)
          : NO_WORKOUTS_RECORDED;
        const hrr = workoutExists
          ? ({
              kind: 'insufficient-data',
              reason: 'workout-stream-decoding-unimplemented: workout_details wire shape is unverified (SPEC.md live blocker)',
            } as const)
          : NO_WORKOUTS_RECORDED;

        const vo2MaxModelA = await resolveVo2MaxModelA(db, source);

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - STRESS_TREND_WINDOW_DAYS * 86400 * 1000);
        const toDate = todayLocalDate(now);
        const fromDate = todayLocalDate(sevenDaysAgo);
        const stressRows = await getStressDaysInRange(db, fromDate, toDate);
        const stressTrend = stressSevenDayTrend({
          days: stressRows.map((r) => ({ localDate: r.local_date, avgStress: r.avg_stress })),
        });

        if (!cancelled) setState({ status: 'ready', data: { vo2MaxModelA, vo2MaxModelB, stressTrend, hrr } });
      } catch (err) {
        if (!cancelled) setState(errorState(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db]);

  return state;
}

async function resolveVo2MaxModelA(db: SqliteDatabase, source: number): Promise<EngineResult<Vo2ModelAResult>> {
  const profile = await getSingletonUserProfile(db);
  if (profile === null) {
    return { kind: 'insufficient-data', reason: 'no user profile synced yet (age is required for HR_max)' };
  }

  const session = await getMostRecentSleepSession(db, source);
  if (session === null) {
    return { kind: 'insufficient-data', reason: 'no sleep session recorded yet' };
  }

  const fetchWindowMinutes = RESTING_HR_SEARCH_MINUTES + RESTING_HR_FETCH_PAD_MINUTES;
  const fromUtc = session.end_utc - fetchWindowMinutes * 60;
  const { from, to } = paddedLocalDateRange(fromUtc, session.end_utc);
  const hrRows = await getHrDaysInRange(db, from, to, source);
  const samples = mapHrDaysToSamplesInRange(hrRows.map(hrDayRowToMapping), fromUtc, session.end_utc);

  const restingResult = computeRestingHr({ samples, sleepEnd: session.end_utc });
  if (restingResult.kind === 'insufficient-data') {
    return restingResult;
  }

  const age = ageFromBirthday(profile.birthday);
  const hrMax = gellishHrMax(age);
  const vo2Max = computeVo2MaxModelA(hrMax, restingResult.value.hrRest);

  return { kind: 'ok', value: { vo2Max, hrRest: restingResult.value.hrRest } };
}
