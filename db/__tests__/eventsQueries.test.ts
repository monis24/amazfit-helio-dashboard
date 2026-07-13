import { openNodeSqliteDatabase } from '../adapters/NodeSqliteAdapter';
import { runMigrations } from '../schema';
import { getStressDaysInRange, getStressPointsInRange } from '../queries/events';
import type { SqliteDatabase } from '../Database';

describe('events read-side getters', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('getStressDaysInRange returns rows within the inclusive local_date range, ordered', async () => {
    await db.runAsync(
      `INSERT INTO stress_days (day_ts_ms, local_date, avg_stress) VALUES (?, ?, ?)`,
      [3, '2026-07-08', 40],
    );
    await db.runAsync(
      `INSERT INTO stress_days (day_ts_ms, local_date, avg_stress) VALUES (?, ?, ?)`,
      [1, '2026-07-01', 20],
    );
    await db.runAsync(
      `INSERT INTO stress_days (day_ts_ms, local_date, avg_stress) VALUES (?, ?, ?)`,
      [2, '2026-07-07', 30],
    );

    const rows = await getStressDaysInRange(db, '2026-07-07', '2026-07-08');
    expect(rows).toEqual([
      { local_date: '2026-07-07', avg_stress: 30 },
      { local_date: '2026-07-08', avg_stress: 40 },
    ]);
  });

  it('getStressPointsInRange returns points in the half-open [fromMs, toMs) window, ordered', async () => {
    await db.runAsync('INSERT INTO stress_points (t_ms, value) VALUES (?, ?)', [1000, 10]);
    await db.runAsync('INSERT INTO stress_points (t_ms, value) VALUES (?, ?)', [2000, 20]);
    await db.runAsync('INSERT INTO stress_points (t_ms, value) VALUES (?, ?)', [3000, 30]);

    const rows = await getStressPointsInRange(db, 1000, 3000);
    expect(rows).toEqual([
      { t_ms: 1000, value: 10 },
      { t_ms: 2000, value: 20 },
    ]);
  });
});
