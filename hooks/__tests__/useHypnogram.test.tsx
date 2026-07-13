import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { DatabaseReactContext } from '../DatabaseContext';
import { useHypnogram } from '../useHypnogram';
import type { SqliteDatabase } from '../../db/Database';

const LOCAL_DATE = '2026-07-08';
const SOURCE = 111;

function wrapperFor(db: SqliteDatabase) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DatabaseReactContext.Provider value={db}>{children}</DatabaseReactContext.Provider>;
  };
}

describe('useHypnogram', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('returns an undefined session when no data has been synced yet', async () => {
    const { result } = await renderHook(() => useHypnogram(LOCAL_DATE), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', data: { session: undefined, segments: [], restlessness: [] } });
  });

  it('returns an undefined session for a wake date with nothing recorded, once a source exists', async () => {
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 'dev1', -25200, new Uint8Array(1440)],
    );
    const { result } = await renderHook(() => useHypnogram('2026-01-01'), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', data: { session: undefined, segments: [], restlessness: [] } });
  });

  it('maps session + labeled segments + restlessness for a recorded night', async () => {
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 'dev1', -25200, new Uint8Array(1440)],
    );
    await db.runAsync(
      `INSERT INTO sleep_sessions (local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr, is_nap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [LOCAL_DATE, SOURCE, 1000, 2200, 20, 10, 5, 5, 55],
    );
    await db.runAsync(
      'INSERT INTO sleep_stage_segments (local_date, source, start_utc, end_utc, stage) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 1000, 1600, 4],
    );
    await db.runAsync(
      'INSERT INTO sleep_stage_segments (local_date, source, start_utc, end_utc, stage) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 1600, 2200, 5],
    );

    const { result } = await renderHook(() => useHypnogram(LOCAL_DATE, 10), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');

    expect(result.current.data.session).toEqual({
      startUtc: 1000,
      endUtc: 2200,
      lightMin: 20,
      deepMin: 10,
      remMin: 5,
      awakeMin: 5,
      restingHr: 55,
    });
    expect(result.current.data.segments).toEqual([
      { startUtc: 1000, endUtc: 1600, stage: 4, label: 'Light' },
      { startUtc: 1600, endUtc: 2200, stage: 5, label: 'Deep' },
    ]);
    expect(result.current.data.restlessness.length).toBeGreaterThan(0);
  });
});
