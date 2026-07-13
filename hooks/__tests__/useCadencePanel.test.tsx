import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import { ageFromBirthday } from '../../types/ZeppApiSchemas';
import { gellishHrMax } from '../../engines/BiometricEngine';
import { DatabaseReactContext } from '../DatabaseContext';
import { useCadencePanel } from '../useCadencePanel';
import type { SqliteDatabase } from '../../db/Database';

const LOCAL_DATE = '2026-07-08';
const SOURCE = 111;

function wrapperFor(db: SqliteDatabase) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DatabaseReactContext.Provider value={db}>{children}</DatabaseReactContext.Provider>;
  };
}

async function seedProfileAndSource(db: SqliteDatabase, hrMinutes: Uint8Array): Promise<void> {
  await db.runAsync(
    'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
    [LOCAL_DATE, SOURCE, 'dev1', 0, hrMinutes],
  );
  await db.runAsync(
    `INSERT INTO user_profile (user_id, birthday, gender, height_cm, weight_kg, nick_name, last_update_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['u1', '1990-01', 1, 180, 75, 'test', 0],
  );
}

describe('useCadencePanel', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('reports insufficient-data when no data has been synced yet', async () => {
    const { result } = await renderHook(() => useCadencePanel(LOCAL_DATE), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.kind).toBe('insufficient-data');
  });

  it('reports insufficient-data when no step segments exist for the date', async () => {
    await seedProfileAndSource(db, new Uint8Array(1440).fill(70));
    const { result } = await renderHook(() => useCadencePanel(LOCAL_DATE), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data).toEqual({ kind: 'insufficient-data', reason: 'no step segments recorded for this date' });
  });

  it('buckets cadence by HR zone for a day with step segments and HR overlap', async () => {
    // With TZ 0, hrBlobAnchorUtc('2026-07-08', 0) is exactly midnight UTC on that date.
    const anchor = Date.UTC(2026, 6, 8, 0, 0, 0) / 1000;
    // 75% of hrMax lands squarely in Z3 (70-80%), independent of "today"'s
    // exact age-derived hrMax (birthday is fixed, but age ticks over yearly).
    const hrMax = gellishHrMax(ageFromBirthday('1990-01'));
    const exerciseBpm = Math.round(hrMax * 0.75);
    const hrMinutes = new Uint8Array(1440).fill(70);
    for (let m = 0; m < 10; m++) hrMinutes[m] = exerciseBpm;
    await seedProfileAndSource(db, hrMinutes);

    await db.runAsync(
      'INSERT INTO step_segments (local_date, source, start_utc, end_utc, mode, steps, distance_m, calories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [LOCAL_DATE, SOURCE, anchor, anchor + 600, 4, 1200, 800, 50],
    );

    const { result } = await renderHook(() => useCadencePanel(LOCAL_DATE), { wrapper: wrapperFor(db) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.data.kind).toBe('ok');
    if (result.current.data.kind === 'ok') {
      expect(result.current.data.value).toEqual([
        { zone: 'Z3', cadenceBuckets: [{ stepsPerMin: 120, minutes: 10 }] },
      ]);
    }
  });
});
