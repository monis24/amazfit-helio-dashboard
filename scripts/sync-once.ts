/**
 * End-to-end Phase 1 dev sync verification script.
 *
 * Runs a real one-shot sync against the live account into a local SQLite
 * file, using NodeSqliteAdapter — there's no iOS/Android simulator in this
 * environment, so this is how Phase 1's sync/persistence logic gets
 * exercised for real rather than only through Jest's mocked/synthetic
 * fixtures. Prints sync-status observable events and a post-sync row count
 * per table so the result is independently checkable, not just "it didn't
 * throw."
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openNodeSqliteDatabase } from '../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../db/schema';
import { createZeppApiService, resolveApiHost } from '../services/ZeppApiService';
import { SyncStatusObservable } from '../services/SyncStatusObservable';
import { EnvFileTokenStore } from '../services/adapters/EnvFileTokenStore';
import { TOKEN_KEYS } from '../services/TokenStore';
import { createFetchTransport } from '../services/HuamiAuth';

const ROOT = join(import.meta.dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const DB_DIR = join(ROOT, 'data');
const DB_PATH = join(DB_DIR, 'local.db');

async function main(): Promise<void> {
  const tokenStore = new EnvFileTokenStore(ENV_PATH);
  const appToken = await tokenStore.getItem(TOKEN_KEYS.appToken);
  const userId = await tokenStore.getItem('ZEPP_USERID');
  if (appToken === undefined || userId === undefined) {
    throw new Error('ZEPP_APPTOKEN / ZEPP_USERID missing from .env');
  }

  console.log('Resolving regional API host...');
  const apiHost = await resolveApiHost(fetch, appToken, userId);
  console.log(`Using host: ${apiHost}`);

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const db = openNodeSqliteDatabase(DB_PATH);
  await runMigrations(db);

  const statusObservable = new SyncStatusObservable();
  statusObservable.subscribe((status) => {
    if (status.phase === 'syncing') console.log(`  syncing: ${status.endpoint}${status.detail ? ` (${status.detail})` : ''}`);
    if (status.phase === 'error') console.log(`  ERROR: ${status.endpoint}: ${status.message}`);
    if (status.phase === 'done') console.log(`  done in ${status.summary.finishedAt - status.summary.startedAt}ms`);
  });

  const service = createZeppApiService({
    transport: fetch,
    db,
    tokenStore,
    userId,
    apiHost,
    statusObservable,
    huamiAuthConfig: { transport: createFetchTransport(fetch) },
  });

  // Last 3 days — enough to exercise band_data, events, and profile without
  // hammering the account with a full-history backfill (SPEC.md's own
  // caution: enumerate/verify, don't scrape aggressively).
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 3);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`\nSyncing ${fmt(fromDate)} to ${fmt(toDate)}...`);
  const summary = await service.syncAll({
    fromDate: fmt(fromDate),
    toDate: fmt(toDate),
    fromMs: fromDate.getTime(),
    toMs: toDate.getTime(),
  });

  console.log('\nSync summary:');
  for (const e of summary.endpoints) {
    console.log(`  ${e.endpoint}: ${e.recordsSynced} record(s)`);
  }

  console.log('\nPost-sync row counts:');
  const tables = [
    'raw_payloads',
    'hr_days',
    'sleep_sessions',
    'sleep_stage_segments',
    'step_segments',
    'activity_days',
    'stress_days',
    'stress_points',
    'spo2_events',
    'pai_days',
    'user_profile',
    'sync_state',
  ];
  for (const table of tables) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`);
    console.log(`  ${table}: ${row?.n ?? 0}`);
  }

  await db.closeAsync();
  console.log(`\nLocal DB at ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
