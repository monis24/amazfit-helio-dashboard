import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { hrBlobAnchorUtc } from '../../db/mappers/dayAnchor';
import { DatabaseReactContext } from '../DatabaseContext';
import { useInsights } from '../useInsights';
import { todayLocalDate as isoDate } from '../localDateRange';
import type { SqliteDatabase } from '../../db/Database';

const LOCAL_DATE = '2026-07-08';
const SOURCE = 111;
const TZ = -25200;
const ANCHOR = hrBlobAnchorUtc(LOCAL_DATE, TZ);

function wrapperFor(db: SqliteDatabase) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DatabaseReactContext.Provider value={db}>{children}</DatabaseReactContext.Provider>;
  };
}

describe('useInsights', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('reports insufficient-data everywhere when no data has been synced yet', async () => {
    const { result } = await renderHook(() => useInsights(), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.vo2MaxModelA.kind).toBe('insufficient-data');
    expect(result.current.data.vo2MaxModelB.kind).toBe('insufficient-data');
    expect(result.current.data.stressTrend.kind).toBe('insufficient-data');
    expect(result.current.data.hrr.kind).toBe('insufficient-data');
  });

  it('computes Model A when a profile, sleep session, and overnight HR exist', async () => {
    // Overnight HR blob: low (resting) readings in the final 2 hours before sleepEnd.
    const hrMinutes = new Uint8Array(1440).fill(80);
    const sleepEndMinuteOfDay = 480; // 08:00 local, well inside the day's own blob
    for (let m = sleepEndMinuteOfDay - 120; m < sleepEndMinuteOfDay; m++) hrMinutes[m] = 55;
    const sleepEnd = ANCHOR + sleepEndMinuteOfDay * 60;

    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 'dev1', TZ, hrMinutes],
    );
    await db.runAsync(
      `INSERT INTO sleep_sessions (local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr, is_nap)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, NULL, 0)`,
      [LOCAL_DATE, SOURCE, sleepEnd - 6 * 3600, sleepEnd],
    );
    await db.runAsync(
      `INSERT INTO user_profile (user_id, birthday, gender, height_cm, weight_kg, nick_name, last_update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['u1', '1990-01', 1, 180, 75, 'test', 0],
    );

    const { result } = await renderHook(() => useInsights(), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.vo2MaxModelA.kind).toBe('ok');
    if (result.current.data.vo2MaxModelA.kind === 'ok') {
      expect(result.current.data.vo2MaxModelA.value.hrRest).toBe(55);
    }
    // No recorded workouts -> Model B/HRR stay insufficient-data regardless of Model A.
    expect(result.current.data.vo2MaxModelB.kind).toBe('insufficient-data');
    expect(result.current.data.hrr.kind).toBe('insufficient-data');
  });

  it('computes a stress trend from stress_days rows in the last 7 days', async () => {
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, 'dev1', TZ, new Uint8Array(1440)],
    );
    const today = new Date();
    const twoDaysAgo = new Date(today.getTime() - 2 * 86400 * 1000);
    await db.runAsync('INSERT INTO stress_days (day_ts_ms, local_date, avg_stress) VALUES (?, ?, ?)', [
      1,
      isoDate(twoDaysAgo),
      20,
    ]);
    await db.runAsync('INSERT INTO stress_days (day_ts_ms, local_date, avg_stress) VALUES (?, ?, ?)', [
      2,
      isoDate(today),
      40,
    ]);

    const { result } = await renderHook(() => useInsights(), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.stressTrend).toEqual({ kind: 'ok', value: { direction: 'up', deltaAvg: 20 } });
  });
});
