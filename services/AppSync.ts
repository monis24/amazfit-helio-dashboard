/**
 * AppSync.ts — the in-app sync trigger. Phase 1 built ZeppApiService.ts and
 * SyncStatusObservable.ts, but nothing in the app ever called them: Phase 3
 * built the four read-only panels without wiring up the write path that
 * fills the on-device DB they read from. Flagged during the After-Phase-3
 * Fable checkpoint — "on a real device, every panel shows 'no data synced
 * yet' forever." This module is the fix: it constructs a real
 * ZeppApiService against the on-device DB (via SecureStoreTokenStore) and
 * runs one sync, reporting progress through the same SyncStatusObservable
 * the panels could already be watching.
 *
 * DELIBERATE REMAINING GAP: nothing here can populate SecureStoreTokenStore
 * in the first place. CLAUDE.md's Phase 0 section is explicit that the full
 * OAuth login flow (with its RN redirect constraint) was never re-translated
 * for the app — only the login_token -> apptoken refresh path was. There is
 * still no in-app login screen, so ZEPP_APPTOKEN/ZEPP_USERID only exist
 * today in the gitignored dev `.env` file, not in the device's Keychain.
 * triggerSync() below handles that honestly: a missing token is reported as
 * a distinct 'not signed in' status, not a crash and not a silent no-op.
 * Getting real credentials onto a real device remains future work (a login
 * UI, or some other one-time bootstrap) — this file doesn't pretend to
 * solve it, only to make everything downstream of "having a token" real.
 */

import { createZeppApiService, resolveApiHost } from './ZeppApiService';
import { createFetchTransport } from './HuamiAuth';
import { SecureStoreTokenStore } from './adapters/SecureStoreTokenStore';
import { TOKEN_KEYS, type TokenStore } from './TokenStore';
import { SyncStatusObservable } from './SyncStatusObservable';
import type { SqliteDatabase } from '../db/Database';

/** Not part of TOKEN_KEYS (that's app-token-refresh keys only) — same
 *  ad-hoc-but-consistent key name scripts/sync-once.ts already uses. */
const USER_ID_KEY = 'ZEPP_USERID';

/** SPEC.md's own caution: enumerate/verify, don't scrape aggressively.
 *  Matches scripts/sync-once.ts's dev-verification window. */
const SYNC_WINDOW_DAYS = 3;

function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Runs one sync against the on-device DB. Never throws — every failure
 * mode (no credentials, host resolution failure, network error) is
 * reported through `statusObservable` instead, since this runs from a
 * fire-and-forget app-startup effect with no caller to hand a rejection to.
 *
 * `tokenStore` defaults to the real SecureStoreTokenStore (production) but
 * is injectable — same DI pattern ZeppApiServiceConfig itself uses — so the
 * "not signed in yet" path is testable without expo-secure-store.
 */
export async function triggerSync(
  db: SqliteDatabase,
  statusObservable: SyncStatusObservable,
  tokenStore: TokenStore = new SecureStoreTokenStore(),
): Promise<void> {
  const [appToken, userId] = await Promise.all([tokenStore.getItem(TOKEN_KEYS.appToken), tokenStore.getItem(USER_ID_KEY)]);
  if (appToken === undefined || userId === undefined) {
    statusObservable.setError('auth', 'not signed in — no credentials in the Keychain yet');
    return;
  }

  try {
    statusObservable.setSyncing('auth', 'resolving API host');
    const apiHost = await resolveApiHost(fetch, appToken, userId);

    const service = createZeppApiService({
      transport: fetch,
      db,
      tokenStore,
      userId,
      apiHost,
      statusObservable,
      huamiAuthConfig: { transport: createFetchTransport(fetch) },
    });

    const toDate = new Date();
    const fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - SYNC_WINDOW_DAYS);

    await service.syncAll({
      fromDate: isoDate(fromDate),
      toDate: isoDate(toDate),
      fromMs: fromDate.getTime(),
      toMs: toDate.getTime(),
    });
  } catch (err) {
    statusObservable.setError('sync', err instanceof Error ? err.message : String(err));
  }
}

export { SyncStatusObservable };
