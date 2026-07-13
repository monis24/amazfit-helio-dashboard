import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { hrBlobAnchorUtc } from '../../db/mappers/dayAnchor';
import { DatabaseReactContext } from '../DatabaseContext';
import { useVitalsPanel } from '../useVitalsPanel';
import type { SqliteDatabase } from '../../db/Database';

const LOCAL_DATE = '2026-07-08';
const TZ = -25200;
const ANCHOR = hrBlobAnchorUtc(LOCAL_DATE, TZ);

function wrapperFor(db: SqliteDatabase) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DatabaseReactContext.Provider value={db}>{children}</DatabaseReactContext.Provider>;
  };
}

describe('useVitalsPanel', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('returns empty vitals when no data has been synced yet', async () => {
    const { result } = await renderHook(() => useVitalsPanel({ fromUtc: 0, toUtc: 3600 }), {
      wrapper: wrapperFor(db),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', data: { hrSamples: [], stressPoints: [] } });
  });

  it('splices hr_days and range-queries stress_points for the requested window', async () => {
    const hrMinutes = new Uint8Array(1440).fill(70);
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, 111, 'dev1', TZ, hrMinutes],
    );
    await db.runAsync('INSERT INTO stress_points (t_ms, value) VALUES (?, ?)', [(ANCHOR + 60) * 1000, 42]);
    await db.runAsync('INSERT INTO stress_points (t_ms, value) VALUES (?, ?)', [(ANCHOR + 10000) * 1000, 99]);

    const { result } = await renderHook(() => useVitalsPanel({ fromUtc: ANCHOR, toUtc: ANCHOR + 180 }), {
      wrapper: wrapperFor(db),
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.hrSamples).toHaveLength(3);
    expect(result.current.data.hrSamples[0]).toEqual({ t: ANCHOR, bpm: 70 });
    expect(result.current.data.stressPoints).toEqual([{ t: ANCHOR + 60, value: 42 }]);
  });
});
