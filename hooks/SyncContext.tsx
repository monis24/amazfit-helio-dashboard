/**
 * SyncContext.tsx — triggers one AppSync.triggerSync() call when the
 * on-device DB becomes ready, and exposes the resulting SyncStatus to any
 * component via useSyncStatus(). Must be rendered inside DatabaseProvider
 * (it reads useDatabase()). Separate from DatabaseContext.tsx on purpose:
 * that file's job is DB connection lifecycle, this one's is "run a sync and
 * let the UI watch it" — related app-startup concerns, not the same one.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { triggerSync } from '../services/AppSync';
import { SyncStatusObservable, type SyncStatus } from '../services/SyncStatusObservable';
import { useDatabase } from './DatabaseContext';

const SyncStatusReactContext = createContext<SyncStatus | undefined>(undefined);

export function SyncProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const db = useDatabase();
  const observableRef = useRef<SyncStatusObservable>(undefined);
  if (observableRef.current === undefined) observableRef.current = new SyncStatusObservable();
  const observable = observableRef.current;

  const [status, setStatus] = useState<SyncStatus>(() => observable.getStatus());

  useEffect(() => {
    const unsubscribe = observable.subscribe(setStatus);
    void triggerSync(db, observable);
    return unsubscribe;
  }, [db, observable]);

  return <SyncStatusReactContext.Provider value={status}>{children}</SyncStatusReactContext.Provider>;
}

/** Undefined outside a SyncProvider — a real programmer error, not a
 *  fallible state screens should render around (matches useDatabase()'s
 *  own contract). */
export function useSyncStatus(): SyncStatus {
  const status = useContext(SyncStatusReactContext);
  if (status === undefined) {
    throw new Error('useSyncStatus() called outside a <SyncProvider>');
  }
  return status;
}
