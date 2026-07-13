/**
 * useVitalsPanel.ts — view model for the Continuous Vitals Panel: minute-by-
 * minute HR plus the device-computed stress scatter overlay, both on the
 * same UTC time axis (SPEC.md's Phase 3 section).
 *
 * Splices hr_days BLOBs across day boundaries and strips the 254 sentinel
 * via db/mappers/hrBlobMapper.ts, which anchors with hrBlobAnchorUtc — NOT
 * segmentAnchorUtc (db/mappers/dayAnchor.ts's doc comment has the
 * live-verified evidence these differ; getting this wrong silently shifts
 * every HR sample by 24 hours).
 */

import { useEffect, useState } from 'react';

import { getHrDaysInRange, getLatestSource } from '../db/queries/bandData';
import { getStressPointsInRange } from '../db/queries/events';
import { hrDayRowToMapping, mapHrDaysToSamplesInRange } from '../db/mappers/hrBlobMapper';
import type { EpochSeconds, HrSample } from '../engines/BiometricEngine';
import { useDatabase } from './DatabaseContext';
import { paddedLocalDateRange } from './localDateRange';
import { errorState, LOADING, type HookState } from './asyncState';

export interface VitalsWindow {
  readonly fromUtc: EpochSeconds;
  readonly toUtc: EpochSeconds;
}

export interface StressPoint {
  readonly t: EpochSeconds;
  /** Device-computed stress score (0-100-ish, vendor algorithm) — label as
   *  such wherever displayed, per SPEC.md's local-vs-device distinction rule. */
  readonly value: number;
}

export interface VitalsViewModel {
  readonly hrSamples: readonly HrSample[];
  readonly stressPoints: readonly StressPoint[];
}

export function useVitalsPanel(window: VitalsWindow): HookState<VitalsViewModel> {
  const db = useDatabase();
  const [state, setState] = useState<HookState<VitalsViewModel>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);

    void (async () => {
      try {
        const source = await getLatestSource(db);
        if (source === null) {
          if (!cancelled) setState({ status: 'ready', data: { hrSamples: [], stressPoints: [] } });
          return;
        }

        const { from, to } = paddedLocalDateRange(window.fromUtc, window.toUtc);
        const hrRows = await getHrDaysInRange(db, from, to, source);
        const hrSamples = mapHrDaysToSamplesInRange(hrRows.map(hrDayRowToMapping), window.fromUtc, window.toUtc);

        const stressRows = await getStressPointsInRange(db, window.fromUtc * 1000, window.toUtc * 1000);
        const stressPoints = stressRows.map((r) => ({ t: Math.floor(r.t_ms / 1000), value: r.value }));

        if (!cancelled) setState({ status: 'ready', data: { hrSamples, stressPoints } });
      } catch (err) {
        if (!cancelled) setState(errorState(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, window.fromUtc, window.toUtc]);

  return state;
}
