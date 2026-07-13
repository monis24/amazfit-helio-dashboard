/**
 * bandData.ts — upserts for everything sourced from the two band_data.json
 * endpoints (query_type=detail -> hr_days; query_type=summary -> sleep +
 * step/activity). Natural key for all of these is (local_date, source):
 * band_data is one record per date_time per user; `uuid` is NOT usable as a
 * key (confirmed live — identical across all sampled days, it's a device/
 * install id, not a record id).
 */

import {
  decodeHrMinutes,
  decodeBandSummary,
  type BandDataRecord,
} from '../../types/ZeppApiSchemas';
import { mapSleepSummaryToSession } from '../mappers/sleepStageMapper';
import { segmentAnchorUtc } from '../mappers/dayAnchor';
import type { SqliteDatabase } from '../Database';

export async function upsertHrDay(db: SqliteDatabase, record: BandDataRecord): Promise<void> {
  const hrMinutes = decodeHrMinutes(record.data_hr);
  const decoded = safeDecodeSummaryForMaxHr(record);

  await db.runAsync(
    `INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes, max_hr_bpm, max_hr_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date, source) DO UPDATE SET
       device_id = excluded.device_id, tz_offset_sec = excluded.tz_offset_sec,
       hr_minutes = excluded.hr_minutes, max_hr_bpm = excluded.max_hr_bpm, max_hr_at_utc = excluded.max_hr_at_utc`,
    [
      record.date_time,
      record.source,
      record.device_id,
      decoded?.tzOffsetSec ?? 0,
      Uint8Array.from(hrMinutes),
      decoded?.maxHrBpm ?? null,
      decoded?.maxHrAtUtc ?? null,
    ],
  );
}

/** hr_days also stores tz/maxHr, which only band_data_summary's decoded payload carries. */
function safeDecodeSummaryForMaxHr(
  record: BandDataRecord,
): { tzOffsetSec: number; maxHrBpm: number | undefined; maxHrAtUtc: number | undefined } | undefined {
  try {
    const decoded = decodeBandSummary(record.summary);
    const tzOffsetSec = Number(decoded.tz);
    const maxHr = decoded.hr.maxHr;
    return {
      tzOffsetSec: Number.isFinite(tzOffsetSec) ? tzOffsetSec : 0,
      maxHrBpm: maxHr.hr > 0 ? maxHr.hr : undefined,
      maxHrAtUtc: maxHr.ts > 0 ? maxHr.ts : undefined,
    };
  } catch {
    // detail and summary are fetched as two separate endpoint calls; a
    // caller might persist HR before summary is available. Not fatal.
    return undefined;
  }
}

export interface SleepUpsertResult {
  readonly kind: 'ok';
}
/** A day with no sleep recorded at all — expected/routine, NOT a bug. */
export interface SleepUpsertNoData {
  readonly kind: 'no-sleep-data';
}
/** The anchoring assertion failed — a real bug/data anomaly, distinct from the routine no-data case above. */
export interface SleepUpsertAnchoringMismatch {
  readonly kind: 'anchoring-mismatch';
  readonly reason: string;
}

/**
 * Upserts sleep_sessions + sleep_stage_segments for one band_data_summary
 * record. Never throws: returns 'no-sleep-data' for a day with nothing
 * recorded (routine), or 'anchoring-mismatch' if the live-verified anchoring
 * assertion fails (a real bug/anomaly — the caller should surface this
 * loudly, not just log it, since it's exactly the class of error that fails
 * silently if nobody's watching).
 */
export async function upsertSleepSummary(
  db: SqliteDatabase,
  record: BandDataRecord,
): Promise<SleepUpsertResult | SleepUpsertNoData | SleepUpsertAnchoringMismatch> {
  const decoded = decodeBandSummary(record.summary);
  if (decoded.slp.stage.length === 0) {
    return { kind: 'no-sleep-data' };
  }

  let session;
  try {
    session = mapSleepSummaryToSession(record.date_time, decoded);
  } catch (err) {
    return { kind: 'anchoring-mismatch', reason: err instanceof Error ? err.message : String(err) };
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sleep_sessions
         (local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr, is_nap)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(local_date, source) DO UPDATE SET
         start_utc = excluded.start_utc, end_utc = excluded.end_utc,
         light_min = excluded.light_min, deep_min = excluded.deep_min,
         rem_min = excluded.rem_min, awake_min = excluded.awake_min,
         resting_hr = excluded.resting_hr`,
      [
        record.date_time,
        record.source,
        session.startUtc,
        session.endUtc,
        session.lightMin,
        session.deepMin,
        session.remMin,
        session.awakeMin,
        session.restingHr ?? null,
      ],
    );

    // Segment sets change wholesale when the device re-merges sleep
    // sessions — delete-and-reinsert per parent rather than diffing.
    await db.runAsync('DELETE FROM sleep_stage_segments WHERE local_date = ? AND source = ?', [
      record.date_time,
      record.source,
    ]);
    for (const seg of session.segments) {
      await db.runAsync(
        `INSERT INTO sleep_stage_segments (local_date, source, start_utc, end_utc, stage) VALUES (?, ?, ?, ?, ?)`,
        [record.date_time, record.source, seg.startUtc, seg.endUtc, seg.stage],
      );
    }
  });

  return { kind: 'ok' };
}

export async function upsertActivitySummary(db: SqliteDatabase, record: BandDataRecord): Promise<void> {
  const decoded = decodeBandSummary(record.summary);
  const { stp } = decoded;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO activity_days
         (local_date, source, total_steps, distance_m, calories, run_distance_m, run_calories, goal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_date, source) DO UPDATE SET
         total_steps = excluded.total_steps, distance_m = excluded.distance_m, calories = excluded.calories,
         run_distance_m = excluded.run_distance_m, run_calories = excluded.run_calories, goal = excluded.goal`,
      [record.date_time, record.source, stp.ttl, stp.dis, stp.cal, stp.runDist, stp.runCal, decoded.goal],
    );

    await db.runAsync('DELETE FROM step_segments WHERE local_date = ? AND source = ?', [
      record.date_time,
      record.source,
    ]);
    for (const seg of stp.stage) {
      // step_segments' minute-offsets share the same day boundary as sleep's
      // — anchor identically (midnight of date_time - 1 day) for consistency,
      // even though this hasn't been independently re-derived live the way
      // sleep anchoring was (see replanning checkpoint notes on step modes).
      const tzOffsetSec = Number(decoded.tz);
      const anchor = segmentAnchorUtc(record.date_time, Number.isFinite(tzOffsetSec) ? tzOffsetSec : 0);
      await db.runAsync(
        `INSERT INTO step_segments (local_date, source, start_utc, end_utc, mode, steps, distance_m, calories)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.date_time,
          record.source,
          anchor + seg.start * 60,
          anchor + (seg.stop + 1) * 60,
          seg.mode,
          seg.step,
          seg.dis,
          seg.cal,
        ],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 3 read-side getters — /hooks reads through these rather than issuing
// raw SQL itself, keeping table shape knowledge inside /db per CLAUDE.md's
// Structure section.
// ---------------------------------------------------------------------------

/**
 * Borrows the most recently synced band_data record's `source` — the same
 * "most recent row wins" pattern ZeppApiService.ts's currentTzOffsetSec
 * already uses for tz_offset_sec. This account has one real device, so
 * there's no source-selection UI to build; /hooks resolve it themselves
 * rather than pushing a source id onto every panel's call site. Null only
 * for a fresh, never-synced database.
 */
export async function getLatestSource(db: SqliteDatabase): Promise<number | null> {
  const row = await db.getFirstAsync<{ source: number }>('SELECT source FROM hr_days ORDER BY local_date DESC LIMIT 1');
  return row?.source ?? null;
}

export interface HrDayRow {
  readonly local_date: string;
  readonly source: number;
  readonly tz_offset_sec: number;
  readonly hr_minutes: Uint8Array;
}

/** Inclusive local_date range, for splicing a UTC time window across day
 *  boundaries — the caller doesn't yet know which calendar day(s) a UTC
 *  window falls into until each row's own tz_offset_sec is read back. */
export async function getHrDaysInRange(
  db: SqliteDatabase,
  fromLocalDate: string,
  toLocalDate: string,
  source: number,
): Promise<readonly HrDayRow[]> {
  return db.getAllAsync<HrDayRow>(
    `SELECT local_date, source, tz_offset_sec, hr_minutes FROM hr_days
     WHERE source = ? AND local_date BETWEEN ? AND ? ORDER BY local_date`,
    [source, fromLocalDate, toLocalDate],
  );
}

export interface SleepSessionRow {
  readonly local_date: string;
  readonly source: number;
  readonly start_utc: number;
  readonly end_utc: number;
  readonly light_min: number;
  readonly deep_min: number;
  readonly rem_min: number;
  readonly awake_min: number;
  readonly resting_hr: number | null;
}

/** `localDate` here is the session's own wake date (sleep_sessions'
 *  primary key), not a UTC day — matches upsertSleepSummary's own keying. */
export async function getSleepSession(
  db: SqliteDatabase,
  localDate: string,
  source: number,
): Promise<SleepSessionRow | null> {
  return db.getFirstAsync<SleepSessionRow>(
    `SELECT local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr
     FROM sleep_sessions WHERE local_date = ? AND source = ?`,
    [localDate, source],
  );
}

/** Most recent session for this source — feeds Model A's overnight scan,
 *  which needs "the last sleep session," not a caller-known wake date. */
export async function getMostRecentSleepSession(db: SqliteDatabase, source: number): Promise<SleepSessionRow | null> {
  return db.getFirstAsync<SleepSessionRow>(
    `SELECT local_date, source, start_utc, end_utc, light_min, deep_min, rem_min, awake_min, resting_hr
     FROM sleep_sessions WHERE source = ? ORDER BY local_date DESC LIMIT 1`,
    [source],
  );
}

export interface SleepStageSegmentRow {
  readonly start_utc: number;
  readonly end_utc: number;
  readonly stage: number;
}

export async function getSleepStageSegments(
  db: SqliteDatabase,
  localDate: string,
  source: number,
): Promise<readonly SleepStageSegmentRow[]> {
  return db.getAllAsync<SleepStageSegmentRow>(
    `SELECT start_utc, end_utc, stage FROM sleep_stage_segments
     WHERE local_date = ? AND source = ? ORDER BY start_utc`,
    [localDate, source],
  );
}

export interface StepSegmentRow {
  readonly start_utc: number;
  readonly end_utc: number;
  readonly mode: number;
  readonly steps: number;
}

export async function getStepSegments(
  db: SqliteDatabase,
  localDate: string,
  source: number,
): Promise<readonly StepSegmentRow[]> {
  return db.getAllAsync<StepSegmentRow>(
    `SELECT start_utc, end_utc, mode, steps FROM step_segments
     WHERE local_date = ? AND source = ? ORDER BY start_utc`,
    [localDate, source],
  );
}
