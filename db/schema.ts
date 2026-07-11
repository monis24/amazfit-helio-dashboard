/**
 * schema.ts — SQLite schema for the local biometric store, designed against
 * FIELD_INVENTORY.md's confirmed live field shapes (see the post-Phase-0
 * Fable replanning checkpoint for the full rationale). Two governing calls:
 *
 * 1. Minute-level HR is stored as one 1440-byte BLOB per day, not one row per
 *    minute. It's a dense fixed-length vector indexed by minute-of-day —
 *    exactly what a BLOB already is — and every real consumer (Vitals Panel,
 *    Model A's overnight scan) reads whole days anyway. Fully normalized,
 *    a year is ~525k rows for data that gains nothing from being rows.
 * 2. Sparse, variable, time-range-queried data (sleep/step segments, stress
 *    points, events) is normalized into rows with an epoch-indexed key, so
 *    range queries crossing day/midnight boundaries are one SQL statement.
 *
 * Every table's primary key is the natural key for last-write-wins conflict
 * resolution (SPEC.md Phase 1) — an upsert on that key is, by construction,
 * "the latest sync wins."
 */

import type { SqliteDatabase } from './Database';

const SCHEMA_VERSION = 1;

const CREATE_TABLES_V1 = `
-- Raw retention: one row per logical record (day/event/workout), upserted
-- last-write-wins on re-sync. Not an append-only log of every fetch.
CREATE TABLE IF NOT EXISTS raw_payloads (
  endpoint    TEXT NOT NULL,
  natural_key TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (endpoint, natural_key)
);

-- One row per day per device source. hr_minutes is the decoded 1440-byte
-- blob (sentinel 254 = no reading, kept in-band, never stripped at rest).
-- byte[0] anchors to LOCAL_DATE'S OWN midnight (db/mappers/dayAnchor.ts's
-- hrBlobAnchorUtc) -- empirically confirmed DIFFERENT from the sleep/step
-- segment convention in this same file (segmentAnchorUtc, one day earlier).
-- Do not assume the two conventions match; see hrBlobAnchorUtc's doc comment
-- for the live-data cross-check that caught this. Only 254 was observed as
-- a sentinel/junk byte in this account's synced data (no 0s/255s) -- a
-- future account/firmware could differ, so treat "not in a plausible bpm
-- range" as the real validity check, not just "not exactly 254".
CREATE TABLE IF NOT EXISTS hr_days (
  local_date    TEXT NOT NULL,
  source        INTEGER NOT NULL,
  device_id     TEXT NOT NULL,
  tz_offset_sec INTEGER NOT NULL,
  hr_minutes    BLOB NOT NULL,
  max_hr_bpm    INTEGER,
  max_hr_at_utc INTEGER,
  PRIMARY KEY (local_date, source)
);

CREATE TABLE IF NOT EXISTS sleep_sessions (
  local_date  TEXT NOT NULL,
  source      INTEGER NOT NULL,
  start_utc   INTEGER NOT NULL,
  end_utc     INTEGER NOT NULL,
  light_min   INTEGER NOT NULL,
  deep_min    INTEGER NOT NULL,
  rem_min     INTEGER NOT NULL,
  awake_min   INTEGER NOT NULL,
  resting_hr  INTEGER,
  is_nap      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (local_date, source)
);

-- start_utc/end_utc are epoch seconds, converted at ingest from the wire's
-- minute-offset-from-midnight-of-(date_time - 1 day) encoding (see
-- db/mappers/sleepStageMapper.ts for the anchoring logic and the assertion
-- that guards against getting this silently wrong). end_utc is EXCLUSIVE.
CREATE TABLE IF NOT EXISTS sleep_stage_segments (
  local_date TEXT NOT NULL,
  source     INTEGER NOT NULL,
  start_utc  INTEGER NOT NULL,
  end_utc    INTEGER NOT NULL,
  stage      INTEGER NOT NULL, -- wire mode code 4|5|7|8; label mapping is a /db-boundary concern
  PRIMARY KEY (local_date, source, start_utc)
);
CREATE INDEX IF NOT EXISTS idx_sleep_seg_time ON sleep_stage_segments(start_utc);

CREATE TABLE IF NOT EXISTS step_segments (
  local_date  TEXT NOT NULL,
  source      INTEGER NOT NULL,
  start_utc   INTEGER NOT NULL,
  end_utc     INTEGER NOT NULL,
  mode        INTEGER NOT NULL, -- 1|3|4|7 (checkpoint-0 research; not independently re-derived live)
  steps       INTEGER NOT NULL,
  distance_m  INTEGER NOT NULL,
  calories    INTEGER NOT NULL,
  PRIMARY KEY (local_date, source, start_utc, mode)
);
CREATE INDEX IF NOT EXISTS idx_step_seg_time ON step_segments(start_utc);

CREATE TABLE IF NOT EXISTS activity_days (
  local_date     TEXT NOT NULL,
  source         INTEGER NOT NULL,
  total_steps    INTEGER,
  distance_m     INTEGER,
  calories       INTEGER,
  run_distance_m INTEGER,
  run_calories   INTEGER,
  goal           INTEGER,
  PRIMARY KEY (local_date, source)
);

-- day_ts_ms is the wire event timestamp (midnight-aligned per account observed).
CREATE TABLE IF NOT EXISTS stress_days (
  day_ts_ms    INTEGER PRIMARY KEY,
  local_date   TEXT NOT NULL,
  min_stress   INTEGER,
  max_stress   INTEGER,
  avg_stress   INTEGER,
  relax_pct    INTEGER,
  normal_pct   INTEGER,
  medium_pct   INTEGER,
  high_pct     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stress_days_date ON stress_days(local_date);

-- t_ms is the point's own "time" field from the decoded stress data series
-- (strictly increasing, confirmed live) — globally unique for one user.
CREATE TABLE IF NOT EXISTS stress_points (
  t_ms  INTEGER PRIMARY KEY,
  value INTEGER NOT NULL
);

-- SpO2 "click" events observed at ~300s cadence live (looks automatic despite
-- the subType name); spo2History stays in raw_payloads only (mostly padding,
-- not signal — see FIELD_INVENTORY.md).
CREATE TABLE IF NOT EXISTS spo2_events (
  t_ms      INTEGER NOT NULL,
  sub_type  TEXT NOT NULL,
  spo2      INTEGER,
  is_auto   INTEGER,
  timezone  TEXT,
  PRIMARY KEY (t_ms, sub_type)
);

CREATE TABLE IF NOT EXISTS pai_days (
  day_ts_ms       INTEGER PRIMARY KEY,
  local_date      TEXT NOT NULL,
  total_pai       REAL,
  daily_pai       REAL,
  device_max_hr   INTEGER, -- Model A cross-check candidate, not auto-adopted
  device_rest_hr  INTEGER,
  low_zone_min    INTEGER,
  medium_zone_min INTEGER,
  high_zone_min   INTEGER
);

-- Singleton. birthday stays "YYYY-MM" as delivered; age is derived at read
-- time (ageFromBirthday in types/ZeppApiSchemas.ts), never stored.
CREATE TABLE IF NOT EXISTS user_profile (
  user_id         TEXT PRIMARY KEY,
  birthday        TEXT NOT NULL,
  gender          INTEGER,
  height_cm       REAL,
  weight_kg       REAL,
  nick_name       TEXT,
  last_update_time INTEGER
);

-- PROVISIONAL: zero live samples existed at Phase 0 discovery time (account
-- has no recorded workouts). Modeled on WorkoutSummaryUnverified; all metric
-- columns nullable. Re-probe sport_run_history/detail and migrate once a
-- real workout exists, per the replanning checkpoint's explicit action item.
CREATE TABLE IF NOT EXISTS workout_summaries (
  track_id     TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  type         INTEGER,
  start_utc    INTEGER,
  distance_m   REAL,
  calories     REAL,
  avg_hr       INTEGER,
  max_hr       INTEGER,
  min_hr       INTEGER,
  avg_pace     REAL,
  avg_cadence  REAL,
  max_cadence  REAL
);

-- Raw stream only, no point columns yet -- sport_run_detail was never probed
-- live (no workouts existed to fetch). Decode once a real sample exists.
CREATE TABLE IF NOT EXISTS workout_details (
  track_id   TEXT PRIMARY KEY,
  raw_detail TEXT NOT NULL
);

-- Per-endpoint sync watermark (last fully-synced local_date or event t_ms).
-- Only advanced past a window once it's been paginated to exhaustion --
-- events endpoints return a 'next' cursor and a naive limit-bounded fetch
-- silently drops most of a day (confirmed: ~288 SpO2 events/day at the
-- observed 5-min cadence, but only 10 returned per page).
CREATE TABLE IF NOT EXISTS sync_state (
  endpoint   TEXT PRIMARY KEY,
  watermark  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

interface Migration {
  readonly version: number;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [{ version: 1, sql: CREATE_TABLES_V1 }];

interface UserVersionRow {
  readonly user_version: number;
}

/** Applies any migrations newer than the DB's current PRAGMA user_version, in order, inside one transaction. */
export async function runMigrations(db: SqliteDatabase): Promise<void> {
  const row = await db.getFirstAsync<UserVersionRow>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const migration of pending) {
      await db.execAsync(migration.sql);
      // PRAGMA doesn't accept bound params; the value is an internal
      // integer literal from MIGRATIONS, never user input.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
  });
}

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;
