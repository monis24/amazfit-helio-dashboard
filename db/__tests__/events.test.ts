import { openNodeSqliteDatabase } from '../adapters/NodeSqliteAdapter';
import { runMigrations } from '../schema';
import { upsertStressEvent, upsertSpo2Event, upsertPaiEvent } from '../queries/events';
import type { SqliteDatabase } from '../Database';
import type { StressEvent, Spo2Event, PaiEvent } from '../../types/ZeppApiSchemas';

function buildStressEvent(overrides: Partial<StressEvent> = {}): StressEvent {
  return {
    userId: 'u1',
    eventType: 'all_day_stress',
    subType: 'all_day_stress',
    timestamp: 1783062000001,
    deviceType: '0',
    minStress: '9',
    maxStress: '62',
    avgStress: '30',
    mediumProportion: '4',
    relaxProportion: '50',
    highProportion: '2',
    normalProportion: '44',
    deviceSn: 'sn',
    deviceId: 'dev',
    deviceSource: '1',
    deviceMac: 'mac',
    data: JSON.stringify([
      { time: 1783066500000, value: 34 },
      { time: 1783066800000, value: 28 },
    ]),
    ...overrides,
  };
}

function buildSpo2Event(overrides: Partial<Spo2Event> = {}): Spo2Event {
  return {
    userId: 'u1',
    eventType: 'blood_oxygen',
    subType: 'click',
    timestamp: 1783315231000,
    timezone: 'America/Los_Angeles',
    extra: JSON.stringify({
      spo2History: [99, 99, 0, 0],
      deviceSource: 1,
      sn: 'sn',
      timestamp: 1783315231000,
      timezone: 'America/Los_Angeles',
      deviceId: 'dev',
      spo2: 99,
      subType: 'click',
      isAuto: false,
    }),
    ...overrides,
  };
}

function buildPaiEvent(overrides: Partial<PaiEvent> = {}): PaiEvent {
  return {
    userId: 'u1',
    eventType: 'PaiHealthInfo',
    subType: 'PaiHealthInfo',
    timestamp: 1783062000000,
    activityScores: '[0,0,0,0,0,0,0]',
    nextActivityScores: '[0,0,0,0,0,0,0]',
    mediumZoneLowerLimit: '117',
    mediumZonePai: '0',
    mediumZoneMinutes: '0',
    gender: '0',
    age: '25',
    deviceId: 'dev',
    lowZoneLowerLimit: '104',
    lowZoneMinutes: '0',
    lowZonePai: '0',
    sn: 'sn',
    maxHr: '195',
    restHr: '65',
    totalPai: '0',
    dailyPai: '0',
    uploadTimestamp: '1783303232000',
    highZonePai: '0',
    highZoneLowerLimit: '156',
    highZoneMinutes: '0',
    index: '3',
    timeZone: '-28',
    version: '5',
    deviceSource: '1',
    time: '1783062000000',
    ...overrides,
  };
}

describe('events query layer', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  // The account's confirmed live tz offset (UTC-7) -- see FIELD_INVENTORY.md.
  const TZ_OFFSET_SEC = -25200;

  it('upsertStressEvent persists the daily aggregate and the decoded point series', async () => {
    await upsertStressEvent(db, buildStressEvent(), TZ_OFFSET_SEC);

    const day = await db.getFirstAsync<{ min_stress: number; max_stress: number; avg_stress: number }>(
      'SELECT min_stress, max_stress, avg_stress FROM stress_days WHERE day_ts_ms = ?',
      [1783062000001],
    );
    expect(day).toEqual({ min_stress: 9, max_stress: 62, avg_stress: 30 });

    const points = await db.getAllAsync<{ t_ms: number; value: number }>(
      'SELECT t_ms, value FROM stress_points ORDER BY t_ms',
    );
    expect(points).toEqual([
      { t_ms: 1783066500000, value: 34 },
      { t_ms: 1783066800000, value: 28 },
    ]);
  });

  it('upsertStressEvent is last-write-wins per day_ts_ms', async () => {
    await upsertStressEvent(db, buildStressEvent({ maxStress: '62' }), TZ_OFFSET_SEC);
    await upsertStressEvent(db, buildStressEvent({ maxStress: '80' }), TZ_OFFSET_SEC);

    const rows = await db.getAllAsync('SELECT * FROM stress_days WHERE day_ts_ms = ?', [1783062000001]);
    expect(rows).toHaveLength(1);
    const day = await db.getFirstAsync<{ max_stress: number }>(
      'SELECT max_stress FROM stress_days WHERE day_ts_ms = ?',
      [1783062000001],
    );
    expect(day!.max_stress).toBe(80);
  });

  it('derives local_date using the account tz offset, not a naive UTC slice (the fixed bug)', async () => {
    // 2026-07-07T02:00:00Z is 2026-07-06T19:00:00 in UTC-7 -- a naive
    // `new Date(ms).toISOString().slice(0, 10)` would mislabel this as
    // 07-07 instead of the correct local date 07-06.
    const crossesUtcMidnight = Date.UTC(2026, 6, 7, 2, 0, 0);
    await upsertStressEvent(db, buildStressEvent({ timestamp: crossesUtcMidnight }), TZ_OFFSET_SEC);
    const day = await db.getFirstAsync<{ local_date: string }>(
      'SELECT local_date FROM stress_days WHERE day_ts_ms = ?',
      [crossesUtcMidnight],
    );
    expect(day!.local_date).toBe('2026-07-06');
  });

  it('upsertSpo2Event extracts the scalar spo2 reading via the type-guarded decoder', async () => {
    await upsertSpo2Event(db, buildSpo2Event());
    const row = await db.getFirstAsync<{ spo2: number; is_auto: number }>(
      'SELECT spo2, is_auto FROM spo2_events WHERE t_ms = ? AND sub_type = ?',
      [1783315231000, 'click'],
    );
    expect(row).toEqual({ spo2: 99, is_auto: 0 });
  });

  it('upsertSpo2Event stores null rather than throwing when extra does not match the confirmed shape', async () => {
    await upsertSpo2Event(db, buildSpo2Event({ extra: JSON.stringify({ notTheRightShape: true }) }));
    const row = await db.getFirstAsync<{ spo2: number | null }>(
      'SELECT spo2 FROM spo2_events WHERE t_ms = ? AND sub_type = ?',
      [1783315231000, 'click'],
    );
    expect(row).toEqual({ spo2: null });
  });

  it('upsertPaiEvent parses wire-string numeric fields into integers', async () => {
    await upsertPaiEvent(db, buildPaiEvent(), TZ_OFFSET_SEC);
    const row = await db.getFirstAsync<{ device_max_hr: number; device_rest_hr: number; total_pai: number }>(
      'SELECT device_max_hr, device_rest_hr, total_pai FROM pai_days WHERE day_ts_ms = ?',
      [1783062000000],
    );
    expect(row).toEqual({ device_max_hr: 195, device_rest_hr: 65, total_pai: 0 });
  });
});
