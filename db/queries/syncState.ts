/**
 * syncState.ts — per-endpoint sync watermark. Only advance the watermark
 * past a window once it's been paginated to exhaustion (events endpoints
 * return a 'next' cursor; a naive limit-bounded fetch silently drops most
 * of a day — see FIELD_INVENTORY.md and schema.ts).
 */

import type { SqliteDatabase } from '../Database';

export async function getWatermark(db: SqliteDatabase, endpoint: string): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ watermark: string }>(
    'SELECT watermark FROM sync_state WHERE endpoint = ?',
    [endpoint],
  );
  return row?.watermark;
}

export async function setWatermark(
  db: SqliteDatabase,
  endpoint: string,
  watermark: string,
  updatedAt: number = Date.now(),
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_state (endpoint, watermark, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET watermark = excluded.watermark, updated_at = excluded.updated_at`,
    [endpoint, watermark, updatedAt],
  );
}
