/**
 * events.ts — upserts for the three confirmed /users/{userid}/events types
 * (stress, SpO2, PAI). All are wire-typed with numeric fields as strings
 * (confirmed live, e.g. "minStress": "9") — parsed once here so /engines and
 * /hooks never see wire-string quirks.
 */

import {
  decodeStressData,
  decodeSpo2Extra,
  type StressEvent,
  type Spo2Event,
  type PaiEvent,
} from '../../types/ZeppApiSchemas';
import type { SqliteDatabase } from '../Database';

function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derives the local calendar date for a midnight-aligned event timestamp.
 * NOT `new Date(epochMs).toISOString().slice(0, 10)` — that's UTC, and is
 * only coincidentally correct for this account's UTC-7 offset. Neither
 * StressEvent nor PaiEvent reliably carries its own per-record tz field
 * (PaiEvent.timeZone's units are ambiguous — see the post-Phase-1 review),
 * so callers pass the account's tz offset explicitly (sourced from the most
 * recently synced band_data record, which does carry a confirmed tz).
 */
function localDateFromEpochMs(epochMs: number, tzOffsetSec: number): string {
  return new Date(epochMs + tzOffsetSec * 1000).toISOString().slice(0, 10);
}

export async function upsertStressEvent(db: SqliteDatabase, event: StressEvent, tzOffsetSec: number): Promise<void> {
  const localDate = localDateFromEpochMs(event.timestamp, tzOffsetSec);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO stress_days
         (day_ts_ms, local_date, min_stress, max_stress, avg_stress, relax_pct, normal_pct, medium_pct, high_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_ts_ms) DO UPDATE SET
         local_date = excluded.local_date, min_stress = excluded.min_stress, max_stress = excluded.max_stress,
         avg_stress = excluded.avg_stress, relax_pct = excluded.relax_pct, normal_pct = excluded.normal_pct,
         medium_pct = excluded.medium_pct, high_pct = excluded.high_pct`,
      [
        event.timestamp,
        localDate,
        parseIntOrNull(event.minStress),
        parseIntOrNull(event.maxStress),
        parseIntOrNull(event.avgStress),
        parseIntOrNull(event.relaxProportion),
        parseIntOrNull(event.normalProportion),
        parseIntOrNull(event.mediumProportion),
        parseIntOrNull(event.highProportion),
      ],
    );

    const points = decodeStressData(event.data);
    for (const point of points) {
      await db.runAsync(
        `INSERT INTO stress_points (t_ms, value) VALUES (?, ?)
         ON CONFLICT(t_ms) DO UPDATE SET value = excluded.value`,
        [point.time, point.value],
      );
    }
  });
}

export async function upsertSpo2Event(db: SqliteDatabase, event: Spo2Event): Promise<void> {
  // Only the scalar spo2 reading is stored structured — spo2History is
  // mostly padding, not signal (confirmed live), and stays in raw_payloads.
  let spo2: number | null = null;
  let isAuto: number | null = null;
  try {
    const extra = decodeSpo2Extra(event.extra);
    spo2 = extra.spo2;
    isAuto = extra.isAuto ? 1 : 0;
  } catch {
    // extra didn't match the confirmed shape; the full JSON string is
    // already preserved verbatim in raw_payloads regardless.
  }

  await db.runAsync(
    `INSERT INTO spo2_events (t_ms, sub_type, spo2, is_auto, timezone) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(t_ms, sub_type) DO UPDATE SET
       spo2 = excluded.spo2, is_auto = excluded.is_auto, timezone = excluded.timezone`,
    [event.timestamp, event.subType, spo2, isAuto, event.timezone],
  );
}

export async function upsertPaiEvent(db: SqliteDatabase, event: PaiEvent, tzOffsetSec: number): Promise<void> {
  const localDate = localDateFromEpochMs(event.timestamp, tzOffsetSec);

  await db.runAsync(
    `INSERT INTO pai_days
       (day_ts_ms, local_date, total_pai, daily_pai, device_max_hr, device_rest_hr,
        low_zone_min, medium_zone_min, high_zone_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day_ts_ms) DO UPDATE SET
       local_date = excluded.local_date, total_pai = excluded.total_pai, daily_pai = excluded.daily_pai,
       device_max_hr = excluded.device_max_hr, device_rest_hr = excluded.device_rest_hr,
       low_zone_min = excluded.low_zone_min, medium_zone_min = excluded.medium_zone_min,
       high_zone_min = excluded.high_zone_min`,
    [
      event.timestamp,
      localDate,
      parseIntOrNull(event.totalPai),
      parseIntOrNull(event.dailyPai),
      parseIntOrNull(event.maxHr),
      parseIntOrNull(event.restHr),
      parseIntOrNull(event.lowZoneMinutes),
      parseIntOrNull(event.mediumZoneMinutes),
      parseIntOrNull(event.highZoneMinutes),
    ],
  );
}

// ---------------------------------------------------------------------------
// Phase 3 read-side getters
// ---------------------------------------------------------------------------

export interface StressDayRow {
  readonly local_date: string;
  readonly avg_stress: number | null;
}

/** Inclusive local_date range — feeds StressTrendEngine.ts's stressSevenDayTrend. */
export async function getStressDaysInRange(
  db: SqliteDatabase,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<readonly StressDayRow[]> {
  return db.getAllAsync<StressDayRow>(
    `SELECT local_date, avg_stress FROM stress_days
     WHERE local_date BETWEEN ? AND ? ORDER BY local_date`,
    [fromLocalDate, toLocalDate],
  );
}

export interface StressPointRow {
  readonly t_ms: number;
  readonly value: number;
}

/** Half-open [fromMs, toMs) — feeds the Continuous Vitals Panel's stress overlay. */
export async function getStressPointsInRange(
  db: SqliteDatabase,
  fromMs: number,
  toMs: number,
): Promise<readonly StressPointRow[]> {
  return db.getAllAsync<StressPointRow>(
    `SELECT t_ms, value FROM stress_points WHERE t_ms >= ? AND t_ms < ? ORDER BY t_ms`,
    [fromMs, toMs],
  );
}
