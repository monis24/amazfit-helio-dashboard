import { openNodeSqliteDatabase } from '../adapters/NodeSqliteAdapter';
import { runMigrations } from '../schema';
import {
  getHrDaysInRange,
  getLatestSource,
  getSleepSession,
  getSleepStageSegments,
  getStepSegments,
} from '../queries/bandData';
import type { SqliteDatabase } from '../Database';

describe('bandData read-side getters', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('getHrDaysInRange returns rows within the inclusive local_date range, ordered', async () => {
    await db.runAsync(
      `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-08', 111, 'dev1', -25200, Uint8Array.from([70])],
    );
    await db.runAsync(
      `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-07', 111, 'dev1', -25200, Uint8Array.from([60])],
    );
    await db.runAsync(
      `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-01', 111, 'dev1', -25200, Uint8Array.from([50])],
    );

    const rows = await getHrDaysInRange(db, '2026-07-07', '2026-07-08', 111);
    expect(rows.map((r) => r.local_date)).toEqual(['2026-07-07', '2026-07-08']);
  });

  it('getLatestSource returns null for a never-synced database', async () => {
    expect(await getLatestSource(db)).toBeNull();
  });

  it('getLatestSource returns the most recent hr_days row\'s source', async () => {
    await db.runAsync(
      `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-07', 111, 'dev1', -25200, Uint8Array.from([60])],
    );
    await db.runAsync(
      `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-08', 222, 'dev1', -25200, Uint8Array.from([70])],
    );
    expect(await getLatestSource(db)).toBe(222);
  });

  it('getSleepSession returns null when nothing is recorded for that date/source', async () => {
    const session = await getSleepSession(db, '2026-07-08', 111);
    expect(session).toBeNull();
  });

  it('getSleepSession + getSleepStageSegments return the persisted rows', async () => {
    await db.runAsync(
      `INSERT INTO sleep_sessions (local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr, is_nap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ['2026-07-08', 111, 1000, 2000, 40, 20, 10, 5, 55],
    );
    await db.runAsync(
      `INSERT INTO sleep_stage_segments (local_date, source, start_utc, end_utc, stage) VALUES (?, ?, ?, ?, ?)`,
      ['2026-07-08', 111, 1000, 1500, 4],
    );

    const session = await getSleepSession(db, '2026-07-08', 111);
    expect(session).toEqual({
      local_date: '2026-07-08',
      source: 111,
      start_utc: 1000,
      end_utc: 2000,
      light_min: 40,
      deep_min: 20,
      rem_min: 10,
      awake_min: 5,
      resting_hr: 55,
    });

    const segments = await getSleepStageSegments(db, '2026-07-08', 111);
    expect(segments).toEqual([{ start_utc: 1000, end_utc: 1500, stage: 4 }]);
  });

  it('getStepSegments returns the persisted rows ordered by start_utc', async () => {
    await db.runAsync(
      `INSERT INTO step_segments (local_date, source, start_utc, end_utc, mode, steps, distance_m, calories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-07-08', 111, 2000, 2600, 1, 100, 80, 5],
    );
    await db.runAsync(
      `INSERT INTO step_segments (local_date, source, start_utc, end_utc, mode, steps, distance_m, calories) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2026-07-08', 111, 1000, 1600, 1, 50, 40, 2],
    );

    const segments = await getStepSegments(db, '2026-07-08', 111);
    expect(segments.map((s) => s.start_utc)).toEqual([1000, 2000]);
  });
});
