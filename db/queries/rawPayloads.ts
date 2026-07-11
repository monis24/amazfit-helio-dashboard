/**
 * rawPayloads.ts — generic raw-retention upsert used for EVERY endpoint
 * (SPEC.md Phase 1: "store full raw payloads — discard nothing"). One row
 * per logical record (per day/event/workout), last-write-wins on re-sync —
 * not an append-only log of every fetch (confirmed with the developer during
 * the post-Phase-0 replanning pass).
 */

import type { SqliteDatabase } from '../Database';

export async function upsertRawPayload(
  db: SqliteDatabase,
  endpoint: string,
  naturalKey: string,
  payload: unknown,
  fetchedAt: number = Date.now(),
): Promise<void> {
  await db.runAsync(
    `INSERT INTO raw_payloads (endpoint, natural_key, fetched_at, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint, natural_key) DO UPDATE SET
       fetched_at = excluded.fetched_at, payload = excluded.payload`,
    [endpoint, naturalKey, fetchedAt, JSON.stringify(payload)],
  );
}
