/**
 * useCadencePanel.ts — view model for the Cadence & Efficiency panel:
 * daily step-cadence histogram bucketed by HR zone (CadenceEngine.ts's
 * cadenceByHrZone). Source is `stp.stage` activity segments (step_segments),
 * available every day regardless of recorded workouts — SPEC.md's Phase 3
 * redirect, given this account's zero-recorded-workouts live blocker.
 */

import { useEffect, useState } from 'react';

import { getHrDaysInRange, getLatestSource, getStepSegments } from '../db/queries/bandData';
import { hrDayRowToMapping, mapHrDaysToSamplesInRange } from '../db/mappers/hrBlobMapper';
import { cadenceByHrZone, type CadenceZoneResult } from '../engines/CadenceEngine';
import type { EngineResult } from '../engines/BiometricEngine';
import { useDatabase } from './DatabaseContext';
import { paddedLocalDateRange } from './localDateRange';
import { resolveHrMax } from './resolveHrMax';
import { errorState, LOADING, type HookState } from './asyncState';

export function useCadencePanel(localDate: string): HookState<EngineResult<readonly CadenceZoneResult[]>> {
  const db = useDatabase();
  const [state, setState] = useState<HookState<EngineResult<readonly CadenceZoneResult[]>>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);

    void (async () => {
      try {
        const source = await getLatestSource(db);
        if (source === null) {
          if (!cancelled) {
            setState({ status: 'ready', data: { kind: 'insufficient-data', reason: 'no data synced yet' } });
          }
          return;
        }

        const hrMaxResult = await resolveHrMax(db);
        if (hrMaxResult.kind === 'insufficient-data') {
          if (!cancelled) setState({ status: 'ready', data: hrMaxResult });
          return;
        }
        const hrMax = hrMaxResult.value;

        const stepRows = await getStepSegments(db, localDate, source);
        const segments = stepRows.map((s) => ({ startUtc: s.start_utc, endUtc: s.end_utc, steps: s.steps }));

        if (segments.length === 0) {
          if (!cancelled) {
            setState({
              status: 'ready',
              data: { kind: 'insufficient-data', reason: 'no step segments recorded for this date' },
            });
          }
          return;
        }

        const dayStart = Math.min(...segments.map((s) => s.startUtc));
        const dayEnd = Math.max(...segments.map((s) => s.endUtc));
        const { from, to } = paddedLocalDateRange(dayStart, dayEnd);
        const hrRows = await getHrDaysInRange(db, from, to, source);
        const hr = mapHrDaysToSamplesInRange(hrRows.map(hrDayRowToMapping), dayStart, dayEnd);

        const result = cadenceByHrZone({ segments, hr, hrMax });
        if (!cancelled) setState({ status: 'ready', data: result });
      } catch (err) {
        if (!cancelled) setState(errorState(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, localDate]);

  return state;
}
