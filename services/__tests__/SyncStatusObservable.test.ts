import { SyncStatusObservable } from '../SyncStatusObservable';

describe('SyncStatusObservable', () => {
  it('starts idle', () => {
    const observable = new SyncStatusObservable();
    expect(observable.getStatus()).toEqual({ phase: 'idle' });
  });

  it('delivers the current status immediately on subscribe', () => {
    const observable = new SyncStatusObservable();
    observable.setSyncing('band_data_detail');
    const received: unknown[] = [];
    observable.subscribe((status) => received.push(status));
    expect(received).toEqual([{ phase: 'syncing', endpoint: 'band_data_detail' }]);
  });

  it('notifies all subscribed listeners of subsequent updates', () => {
    const observable = new SyncStatusObservable();
    const a: unknown[] = [];
    const b: unknown[] = [];
    observable.subscribe((s) => a.push(s));
    observable.subscribe((s) => b.push(s));

    observable.setSyncing('events_stress', 'page 2');
    observable.setDone({ startedAt: 1, finishedAt: 2, endpoints: [{ endpoint: 'events_stress', recordsSynced: 47 }] });

    expect(a).toHaveLength(3); // initial idle + 2 updates
    expect(b).toHaveLength(3);
    expect(a).toEqual(b);
    expect(a[2]).toEqual({
      phase: 'done',
      summary: { startedAt: 1, finishedAt: 2, endpoints: [{ endpoint: 'events_stress', recordsSynced: 47 }] },
    });
  });

  it('stops notifying after unsubscribe', () => {
    const observable = new SyncStatusObservable();
    const received: unknown[] = [];
    const unsubscribe = observable.subscribe((s) => received.push(s));
    unsubscribe();

    observable.setError('band_data_detail', 'network timeout');
    expect(received).toHaveLength(1); // only the initial idle delivery
  });

  it('setError produces an error status with endpoint and message', () => {
    const observable = new SyncStatusObservable();
    observable.setError('sport_run_history', 'HTTP 500');
    expect(observable.getStatus()).toEqual({ phase: 'error', endpoint: 'sport_run_history', message: 'HTTP 500' });
  });
});
