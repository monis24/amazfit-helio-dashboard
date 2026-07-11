/**
 * workouts.ts — PROVISIONAL. Zero live samples existed at Phase 0 discovery
 * time (account had no recorded workouts), so WorkoutSummaryUnverified is
 * modeled from rolandsz/Mi-Fit-and-Zepp-workout-exporter's documented
 * schema, not a live sample. workout_details stores the raw stream
 * unparsed — sport_run_detail was never probed live. Re-probe and extend
 * both once a real workout exists, per the replanning checkpoint's explicit
 * action item (record one phone-GPS workout before Phase 3).
 */

import type { WorkoutSummaryUnverified } from '../../types/ZeppApiSchemas';
import type { SqliteDatabase } from '../Database';

export async function upsertWorkoutSummary(db: SqliteDatabase, workout: WorkoutSummaryUnverified): Promise<void> {
  await db.runAsync(
    `INSERT INTO workout_summaries
       (track_id, source, type, distance_m, calories, avg_hr, max_hr, min_hr, avg_pace, avg_cadence, max_cadence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET
       source = excluded.source, type = excluded.type, distance_m = excluded.distance_m,
       calories = excluded.calories, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr,
       min_hr = excluded.min_hr, avg_pace = excluded.avg_pace, avg_cadence = excluded.avg_cadence,
       max_cadence = excluded.max_cadence`,
    [
      workout.trackid,
      workout.source,
      workout.type ?? null,
      workout.dis ?? null,
      workout.calorie ?? null,
      workout.avg_heart_rate ?? null,
      workout.max_heart_rate ?? null,
      workout.min_heart_rate ?? null,
      workout.avg_pace ?? null,
      workout.avg_cadence ?? null,
      workout.max_cadence ?? null,
    ],
  );
}

export async function upsertWorkoutDetail(db: SqliteDatabase, trackId: string, rawDetail: unknown): Promise<void> {
  await db.runAsync(
    `INSERT INTO workout_details (track_id, raw_detail) VALUES (?, ?)
     ON CONFLICT(track_id) DO UPDATE SET raw_detail = excluded.raw_detail`,
    [trackId, JSON.stringify(rawDetail)],
  );
}
