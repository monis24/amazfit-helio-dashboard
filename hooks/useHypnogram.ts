/**
 * useHypnogram.ts — view model for the Granular Sleep Hypnogram: exact
 * epoch-timestamp stage segments (Gantt-style, SPEC.md's Phase 3 section)
 * plus the transition-density restlessness companion graph
 * (RestlessnessEngine.ts's restlessnessProxy).
 *
 * Label mapping (wire stage code -> "Light"/"Deep"/"REM"/"Awake") happens
 * here, not in /db or /engines — db/schema.ts's sleep_stage_segments
 * comment calls this "a /db-boundary concern," and /hooks is exactly that
 * boundary between raw storage and the presentational /screens layer.
 */

import { useEffect, useState } from 'react';

import { getSleepSession, getSleepStageSegments, getLatestSource } from '../db/queries/bandData';
import { SLEEP_STAGE_LABELS, type SleepStageMode } from '../types/ZeppApiSchemas';
import { restlessnessProxy, type RestlessnessPoint } from '../engines/RestlessnessEngine';
import type { EpochSeconds } from '../engines/BiometricEngine';
import { useDatabase } from './DatabaseContext';
import { errorState, LOADING, type HookState } from './asyncState';

/** SPEC.md doesn't pin an exact bucket width for the restlessness graph;
 *  15 minutes gives ~32 buckets across a typical 8-hour session — enough
 *  resolution to see restless stretches without a bucket-per-minute chart. */
const DEFAULT_BUCKET_MINUTES = 15;

export interface HypnogramSegment {
  readonly startUtc: EpochSeconds;
  readonly endUtc: EpochSeconds;
  /** Undefined for a wire stage code outside the four confirmed values
   *  (SLEEP_STAGE_LABELS) — genuinely unknown, not coerced to a guess. */
  readonly stage: SleepStageMode | undefined;
  readonly label: string;
}

export interface HypnogramSession {
  readonly startUtc: EpochSeconds;
  readonly endUtc: EpochSeconds;
  readonly lightMin: number;
  readonly deepMin: number;
  readonly remMin: number;
  readonly awakeMin: number;
  readonly restingHr: number | undefined;
}

export interface HypnogramViewModel {
  /** Undefined for a wake date with no sleep recorded — routine, not an error. */
  readonly session: HypnogramSession | undefined;
  readonly segments: readonly HypnogramSegment[];
  readonly restlessness: readonly RestlessnessPoint[];
}

function isSleepStageMode(value: number): value is SleepStageMode {
  return value === 4 || value === 5 || value === 7 || value === 8;
}

export function useHypnogram(wakeDate: string, bucketMinutes: number = DEFAULT_BUCKET_MINUTES): HookState<HypnogramViewModel> {
  const db = useDatabase();
  const [state, setState] = useState<HookState<HypnogramViewModel>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);

    void (async () => {
      try {
        const source = await getLatestSource(db);
        if (source === null) {
          if (!cancelled) setState({ status: 'ready', data: { session: undefined, segments: [], restlessness: [] } });
          return;
        }

        const [sessionRow, segmentRows] = await Promise.all([
          getSleepSession(db, wakeDate, source),
          getSleepStageSegments(db, wakeDate, source),
        ]);

        if (sessionRow === null) {
          if (!cancelled) setState({ status: 'ready', data: { session: undefined, segments: [], restlessness: [] } });
          return;
        }

        const segments: HypnogramSegment[] = segmentRows.map((seg) => ({
          startUtc: seg.start_utc,
          endUtc: seg.end_utc,
          stage: isSleepStageMode(seg.stage) ? seg.stage : undefined,
          label: isSleepStageMode(seg.stage) ? SLEEP_STAGE_LABELS[seg.stage] : 'Unknown',
        }));

        const restlessness = restlessnessProxy(
          segmentRows.map((seg) => ({ startUtc: seg.start_utc, endUtc: seg.end_utc, stage: seg.stage })),
          bucketMinutes,
        );

        const session: HypnogramSession = {
          startUtc: sessionRow.start_utc,
          endUtc: sessionRow.end_utc,
          lightMin: sessionRow.light_min,
          deepMin: sessionRow.deep_min,
          remMin: sessionRow.rem_min,
          awakeMin: sessionRow.awake_min,
          restingHr: sessionRow.resting_hr ?? undefined,
        };

        if (!cancelled) setState({ status: 'ready', data: { session, segments, restlessness } });
      } catch (err) {
        if (!cancelled) setState(errorState(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, wakeDate, bucketMinutes]);

  return state;
}
