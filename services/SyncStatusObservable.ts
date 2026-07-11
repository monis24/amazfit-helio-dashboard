/**
 * SyncStatusObservable.ts — dependency-free pub-sub exposing sync progress
 * (SPEC.md Phase 1: "expose sync progress as a reactive state observable the
 * UI can subscribe to"). No external RN library (no EventEmitter polyfill
 * dependency) — a Set of listener callbacks is all this needs, and it's
 * identical under Node (Jest, the dev sync script) and React Native.
 */

export interface SyncEndpointSummary {
  readonly endpoint: string;
  readonly recordsSynced: number;
  /**
   * Non-fatal, per-record issues surfaced during this endpoint's sync (e.g.
   * a sleep-stage anchoring-assertion failure for one day) — the endpoint
   * still succeeded overall, but something was skipped and should be visible
   * rather than only reaching a console.warn nobody in a production RN app
   * would see.
   */
  readonly warnings?: readonly string[];
}

export interface SyncSummary {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly endpoints: readonly SyncEndpointSummary[];
}

export type SyncStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'syncing'; readonly endpoint: string; readonly detail?: string }
  | { readonly phase: 'done'; readonly summary: SyncSummary }
  | { readonly phase: 'error'; readonly endpoint: string; readonly message: string };

export type SyncStatusListener = (status: SyncStatus) => void;

export class SyncStatusObservable {
  private status: SyncStatus = { phase: 'idle' };
  private readonly listeners = new Set<SyncStatusListener>();

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Subscribing immediately delivers the current status, then future updates. Returns an unsubscribe function. */
  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setIdle(): void {
    this.emit({ phase: 'idle' });
  }

  setSyncing(endpoint: string, detail?: string): void {
    this.emit(detail !== undefined ? { phase: 'syncing', endpoint, detail } : { phase: 'syncing', endpoint });
  }

  setDone(summary: SyncSummary): void {
    this.emit({ phase: 'done', summary });
  }

  setError(endpoint: string, message: string): void {
    this.emit({ phase: 'error', endpoint, message });
  }

  private emit(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
