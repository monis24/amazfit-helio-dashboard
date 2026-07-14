/**
 * useHrMax.ts — thin HookState wrapper around resolveHrMax() for direct use
 * in a component (VitalsPanel's HR-zone coloring), as opposed to
 * useCadencePanel/useInsights which call resolveHrMax() inline as one step
 * of their own larger async orchestration.
 */

import { useEffect, useState } from 'react';

import { resolveHrMax } from './resolveHrMax';
import { useDatabase } from './DatabaseContext';
import { errorState, LOADING, type HookState } from './asyncState';
import type { EngineResult } from '../engines/BiometricEngine';

export function useHrMax(): HookState<EngineResult<number>> {
  const db = useDatabase();
  const [state, setState] = useState<HookState<EngineResult<number>>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setState(LOADING);
    void resolveHrMax(db)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', data: result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(errorState(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  return state;
}
