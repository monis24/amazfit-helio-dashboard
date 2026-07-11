import { openNodeSqliteDatabase } from '../adapters/NodeSqliteAdapter';
import { runMigrations } from '../schema';
import { upsertUserProfile, getUserProfile } from '../queries/userProfile';
import { upsertWorkoutSummary, upsertWorkoutDetail } from '../queries/workouts';
import { upsertRawPayload } from '../queries/rawPayloads';
import { getWatermark, setWatermark } from '../queries/syncState';
import type { SqliteDatabase } from '../Database';
import type { UserProfile, WorkoutSummaryUnverified } from '../../types/ZeppApiSchemas';

describe('userProfile query layer', () => {
  let db: SqliteDatabase;
  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });
  afterEach(async () => db.closeAsync());

  const profile: UserProfile = {
    userId: '3096033568',
    nickName: 'mm',
    applicationName: 'com.xiaomi.hm.health',
    applicationPlatform: 'ios_phone',
    birthday: '2001-03',
    createTime: 1783049320,
    gender: 1,
    height: 185,
    idSource: 'huami',
    lastUpdateTime: 1783049377,
    weight: 89.947365,
    preferredLanguage: 'en_US',
    userOldProfile: { nickName: 'mm' },
    defaultFields: [],
  };

  it('upserts and reads back the singleton profile', async () => {
    await upsertUserProfile(db, profile);
    const row = await getUserProfile(db, '3096033568');
    expect(row).toMatchObject({ birthday: '2001-03', height_cm: 185, nick_name: 'mm' });
  });

  it('is last-write-wins on user_id', async () => {
    await upsertUserProfile(db, profile);
    await upsertUserProfile(db, { ...profile, weight: 90.5, lastUpdateTime: 2000 });
    const row = await getUserProfile(db, '3096033568');
    expect(row!.weight_kg).toBe(90.5);
    expect(row!.last_update_time).toBe(2000);
  });
});

describe('workouts query layer (provisional)', () => {
  let db: SqliteDatabase;
  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });
  afterEach(async () => db.closeAsync());

  it('upserts a workout summary with nullable metric fields', async () => {
    const workout: WorkoutSummaryUnverified = { trackid: 't1', source: 'src1', avg_heart_rate: 140 };
    await upsertWorkoutSummary(db, workout);
    const row = await db.getFirstAsync<{ avg_hr: number; max_hr: number | null }>(
      'SELECT avg_hr, max_hr FROM workout_summaries WHERE track_id = ?',
      ['t1'],
    );
    expect(row).toEqual({ avg_hr: 140, max_hr: null });
  });

  it('stores an undecoded workout detail stream as raw JSON', async () => {
    await upsertWorkoutDetail(db, 't1', { heart_rate: '120,121,122' });
    const row = await db.getFirstAsync<{ raw_detail: string }>(
      'SELECT raw_detail FROM workout_details WHERE track_id = ?',
      ['t1'],
    );
    expect(JSON.parse(row!.raw_detail)).toEqual({ heart_rate: '120,121,122' });
  });
});

describe('rawPayloads query layer', () => {
  let db: SqliteDatabase;
  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });
  afterEach(async () => db.closeAsync());

  it('upserts a payload keyed by (endpoint, natural_key), last-write-wins', async () => {
    await upsertRawPayload(db, 'band_data_detail', '2026-07-07', { a: 1 }, 1000);
    await upsertRawPayload(db, 'band_data_detail', '2026-07-07', { a: 2 }, 2000);

    const rows = await db.getAllAsync('SELECT * FROM raw_payloads');
    expect(rows).toHaveLength(1);
    const row = await db.getFirstAsync<{ payload: string; fetched_at: number }>(
      'SELECT payload, fetched_at FROM raw_payloads WHERE endpoint = ? AND natural_key = ?',
      ['band_data_detail', '2026-07-07'],
    );
    expect(JSON.parse(row!.payload)).toEqual({ a: 2 });
    expect(row!.fetched_at).toBe(2000);
  });
});

describe('syncState query layer', () => {
  let db: SqliteDatabase;
  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });
  afterEach(async () => db.closeAsync());

  it('returns undefined for an endpoint with no watermark yet', async () => {
    expect(await getWatermark(db, 'events_stress')).toBeUndefined();
  });

  it('sets and advances a watermark', async () => {
    await setWatermark(db, 'events_stress', '2026-07-07');
    expect(await getWatermark(db, 'events_stress')).toBe('2026-07-07');
    await setWatermark(db, 'events_stress', '2026-07-08');
    expect(await getWatermark(db, 'events_stress')).toBe('2026-07-08');
  });
});
