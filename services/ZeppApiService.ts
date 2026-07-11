/**
 * ZeppApiService.ts — Phase 1 cloud API service (SPEC.md Phase 1).
 *
 * Integrates the Phase 0 OAuth module (HuamiAuth.ts) for token refresh only —
 * the full login flow (with its RN redirect constraint) isn't re-translated
 * here, per SPEC.md's explicit instruction. Fetches every confirmed
 * FIELD_INVENTORY.md endpoint, persists both the raw payload (discard
 * nothing) and the typed/normalized rows via the /db query layer, retries
 * network failures with exponential backoff, and reports progress through
 * SyncStatusObservable.
 *
 * HOST NOTE: `apiHost` must be the live-confirmed data-API host
 * (https://api-mifit-us2.zepp.com for this account — see FIELD_INVENTORY.md),
 * resolved via services/ZeppHost.ts's detectApiHost — NOT HuamiAuth.ts's
 * default host builder, which targets the classic huami.com login flow and
 * has no bearing on which host actually serves this account's data.
 */

import { refreshAppToken, type HuamiAuthConfig } from './HuamiAuth';
import { detectApiHost, type FetchLike } from './ZeppHost';
import { TOKEN_KEYS, type TokenStore } from './TokenStore';
import { withRetry } from './retry';
import { ZeppApiError, isRetryableZeppError, needsTokenRefresh, isRetryableHuamiAuthError } from './ZeppApiError';
import { SyncStatusObservable, type SyncSummary, type SyncEndpointSummary } from './SyncStatusObservable';
import { upsertRawPayload } from '../db/queries/rawPayloads';
import { setWatermark } from '../db/queries/syncState';
import { upsertHrDay, upsertSleepSummary, upsertActivitySummary } from '../db/queries/bandData';
import { upsertStressEvent, upsertSpo2Event, upsertPaiEvent } from '../db/queries/events';
import { upsertUserProfile } from '../db/queries/userProfile';
import { upsertWorkoutSummary } from '../db/queries/workouts';
import type { SqliteDatabase } from '../db/Database';
import type {
  BandDataResponse,
  EventsResponse,
  StressEvent,
  Spo2Event,
  PaiEvent,
  UserProfile,
  DevicesResponse,
  SportRunHistoryResponse,
} from '../types/ZeppApiSchemas';

export interface ZeppApiServiceConfig {
  readonly transport: FetchLike;
  readonly db: SqliteDatabase;
  readonly tokenStore: TokenStore;
  readonly userId: string;
  /** The live-confirmed data-API host — see the module comment above. */
  readonly apiHost: string;
  readonly statusObservable: SyncStatusObservable;
  /** Only used for refreshAppToken (login_token -> app_token); never the full login flow. */
  readonly huamiAuthConfig: HuamiAuthConfig;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly eventsPageLimit?: number;
}

export interface SyncRange {
  readonly fromDate: string;
  readonly toDate: string;
  readonly fromMs: number;
  readonly toMs: number;
}

export interface EndpointRunResult {
  readonly recordsSynced: number;
  readonly warnings?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createZeppApiService(config: ZeppApiServiceConfig) {
  const maxAttempts = config.maxAttempts ?? 4;
  const baseDelayMs = config.baseDelayMs ?? 500;
  const eventsPageLimit = config.eventsPageLimit ?? 50;

  async function getAppToken(): Promise<string> {
    const token = await config.tokenStore.getItem(TOKEN_KEYS.appToken);
    if (token === undefined) {
      // kind: 'missing-token' -- not retryable as-is (retrying without a
      // token can't succeed) and routes straight to the refresh path below,
      // rather than burning the backoff budget on a request that will fail
      // identically every time.
      throw new ZeppApiError('no app token available', 'missing-token');
    }
    return token;
  }

  /** Refresh via the stored login_token, itself retried on transient failures; never re-attempts the full password login. */
  async function refreshAndPersistToken(): Promise<string> {
    const loginToken = await config.tokenStore.getItem(TOKEN_KEYS.loginToken);
    const countryCode = await config.tokenStore.getItem(TOKEN_KEYS.countryCode);
    if (loginToken === undefined || countryCode === undefined) {
      throw new ZeppApiError(
        'cannot refresh app token: no login_token/country_code stored — a full password login is required',
        'missing-token',
      );
    }
    const refreshed = await withRetry(() => refreshAppToken(loginToken, countryCode, config.huamiAuthConfig), {
      maxAttempts,
      baseDelayMs,
      isRetryable: isRetryableHuamiAuthError,
    });
    await config.tokenStore.setItem(TOKEN_KEYS.appToken, refreshed.appToken);
    if (refreshed.rotatedLoginToken !== undefined) {
      await config.tokenStore.setItem(TOKEN_KEYS.loginToken, refreshed.rotatedLoginToken);
    }
    return refreshed.appToken;
  }

  /**
   * Fetches one JSON endpoint with retry/backoff, then trap-B body-error
   * checking (HTTP 200 with an error `code`), then — on a missing/401/403
   * token — one refresh (itself retried on transient failure) followed by a
   * full retry-with-backoff of the original request, not a single bare
   * attempt (a transient failure right after a successful refresh used to
   * propagate unretried).
   */
  async function fetchZeppJson<T>(path: string): Promise<T> {
    const attempt = async (): Promise<T> => {
      const appToken = await getAppToken();
      const url = `${config.apiHost}${path}`;
      let status: number;
      let body: string;
      try {
        const response = await config.transport(url, { method: 'GET', headers: { apptoken: appToken } });
        status = response.status;
        body = await response.text();
      } catch (err) {
        throw new ZeppApiError(
          `network error fetching ${path}: ${err instanceof Error ? err.message : String(err)}`,
          'network',
        );
      }

      if (status === 401 || status === 403) {
        throw new ZeppApiError(`auth error fetching ${path}`, 'http-status', { httpStatus: status });
      }
      if (status >= 500 || status === 429) {
        throw new ZeppApiError(`server error (${status}) fetching ${path}`, 'http-status', { httpStatus: status });
      }
      if (status !== 200) {
        throw new ZeppApiError(`unexpected status ${status} fetching ${path}`, 'http-status', { httpStatus: status });
      }

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new ZeppApiError(`non-JSON response fetching ${path}`, 'http-status', { httpStatus: status });
      }

      // Trap B: some endpoints wrap responses in {code, message, data} and a
      // non-1 code signals failure even under HTTP 200; others (events,
      // profile) return the payload directly and only carry `code` when
      // something's wrong (e.g. {"code": -2001, "message": "Not found"}).
      if (isRecord(json) && typeof json['code'] === 'number' && json['code'] !== 1) {
        throw new ZeppApiError(
          `API error code=${json['code']} fetching ${path}: ${String(json['message'] ?? '')}`,
          'body-error',
          { httpStatus: status, bodyCode: json['code'] },
        );
      }

      return json as T;
    };

    const attemptWithRetry = () => withRetry(attempt, { maxAttempts, baseDelayMs, isRetryable: isRetryableZeppError });

    try {
      return await attemptWithRetry();
    } catch (err) {
      if (needsTokenRefresh(err)) {
        await refreshAndPersistToken();
        return attemptWithRetry(); // full retry-with-backoff, not a single bare attempt
      }
      throw err;
    }
  }

  async function syncBandData(fromDate: string, toDate: string): Promise<EndpointRunResult> {
    let count = 0;
    const warnings: string[] = [];

    config.statusObservable.setSyncing('band_data_detail');
    const detail = await fetchZeppJson<BandDataResponse>(
      `/v1/data/band_data.json?query_type=detail&userid=${encodeURIComponent(config.userId)}&device_type=android_phone&from_date=${fromDate}&to_date=${toDate}`,
    );
    for (const record of detail.data) {
      await upsertRawPayload(config.db, 'band_data_detail', record.date_time, record);
      await upsertHrDay(config.db, record);
      count += 1;
    }

    config.statusObservable.setSyncing('band_data_summary');
    const summary = await fetchZeppJson<BandDataResponse>(
      `/v1/data/band_data.json?query_type=summary&userid=${encodeURIComponent(config.userId)}&device_type=android_phone&from_date=${fromDate}&to_date=${toDate}`,
    );
    for (const record of summary.data) {
      await upsertRawPayload(config.db, 'band_data_summary', record.date_time, record);
      const sleepResult = await upsertSleepSummary(config.db, record);
      // 'no-sleep-data' is routine (a day with nothing recorded) and not
      // warned about. 'anchoring-mismatch' is a real anomaly — surfaced
      // through the summary/observable, not just a console.warn nobody in a
      // production RN app would see.
      if (sleepResult.kind === 'anchoring-mismatch') {
        const message = `sleep anchoring mismatch for ${record.date_time}: ${sleepResult.reason}`;
        warnings.push(message);
        console.warn(`[ZeppApiService] ${message}`);
      }
      await upsertActivitySummary(config.db, record);
      count += 1;
    }

    return { recordsSynced: count, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  /**
   * Persists the paired-device list raw (SPEC.md Phase 1: "discard
   * nothing"). No typed table exists for this yet — nothing in Phase 2/3
   * needs structured device fields — so this is raw-only, same pattern as
   * workout_details for an undecoded stream.
   */
  async function syncDevices(): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('devices');
    const devices = await fetchZeppJson<DevicesResponse>(`/users/${encodeURIComponent(config.userId)}/devices`);
    for (const device of devices.items) {
      await upsertRawPayload(config.db, 'devices', device.deviceId, device);
    }
    return { recordsSynced: devices.items.length };
  }

  /**
   * Confirmed live at Phase 0 (200, `next: -1`, empty summary — the account
   * has zero recorded workouts), but was left OUT of syncAll entirely in the
   * first Phase 1 pass, meaning the account's first real workout would never
   * be ingested and upsertWorkoutSummary was dead code. Wired in now.
   *
   * Pagination cursor (`trackid`) is per checkpoint-0 research, not verified
   * against a real multi-page response (no live account has one yet) — the
   * `maxPages` guard exists specifically because this loop's termination
   * condition (`next === -1`) is unverified for the true multi-page case;
   * re-check this once a real workout exists (see the Phase 0 replanning
   * checkpoint's action item to record one and re-probe).
   */
  async function syncWorkouts(): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('sport_run_history');
    const maxPages = 1000;
    let count = 0;
    let cursor: number | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const path = `/v1/sport/run/history.json${cursor !== undefined ? `?trackid=${cursor}` : ''}`;
      const response = await fetchZeppJson<SportRunHistoryResponse>(path);
      for (const workout of response.data.summary) {
        await upsertRawPayload(config.db, 'sport_run_history', workout.trackid, workout);
        await upsertWorkoutSummary(config.db, workout);
        count += 1;
      }
      if (response.data.next === -1 || response.data.summary.length === 0) break;
      cursor = response.data.next;
    }

    return { recordsSynced: count };
  }

  async function syncUserProfile(): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('user_profile');
    const profile = await fetchZeppJson<UserProfile>(`/users/${encodeURIComponent(config.userId)}`);
    await upsertRawPayload(config.db, 'user_profile', config.userId, profile);
    await upsertUserProfile(config.db, profile);
    return { recordsSynced: 1 };
  }

  /**
   * Paginates an events endpoint to exhaustion. The `next` field's exact
   * contract is undocumented (FIELD_INVENTORY.md: it looks like a peek at
   * the next page's first event, not a cursor token), so this advances by
   * strictly increasing `from = lastSeenTimestamp + 1` and stops once a page
   * returns fewer than `limit` items — correct against observed behavior
   * without depending on next's unconfirmed semantics, and always makes
   * progress (no infinite-loop risk).
   */
  async function fetchAllEvents<T extends { timestamp: number }>(
    eventType: string,
    fromMs: number,
    toMs: number,
  ): Promise<T[]> {
    const all: T[] = [];
    let from = fromMs;

    while (from <= toMs) {
      const page = await fetchZeppJson<EventsResponse<T>>(
        `/users/${encodeURIComponent(config.userId)}/events?eventType=${eventType}&limit=${eventsPageLimit}&from=${from}&to=${toMs}`,
      );
      if (page.items.length === 0) break;
      all.push(...page.items);
      const last = page.items[page.items.length - 1] as T;
      if (page.items.length < eventsPageLimit) break;
      from = last.timestamp + 1;
    }
    return all;
  }

  /**
   * Neither StressEvent nor PaiEvent reliably carries its own tz offset
   * (PaiEvent.timeZone's units are ambiguous), so their local_date derivation
   * borrows the most recently synced band_data record's confirmed tz_offset_sec
   * instead of assuming UTC. Falls back to 0 (UTC) — logged, not silent — if
   * band_data hasn't synced anything yet (e.g. a fresh account, or events
   * synced standalone rather than through syncAll's band_data-first order).
   */
  async function currentTzOffsetSec(): Promise<number> {
    const row = await config.db.getFirstAsync<{ tz_offset_sec: number }>(
      'SELECT tz_offset_sec FROM hr_days ORDER BY local_date DESC LIMIT 1',
    );
    if (row === null) {
      console.warn(
        '[ZeppApiService] no hr_days row yet to source a tz offset from; assuming UTC (0) for event local_date derivation',
      );
      return 0;
    }
    return row.tz_offset_sec;
  }

  async function syncStressEvents(fromMs: number, toMs: number): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('events_stress');
    const tzOffsetSec = await currentTzOffsetSec();
    const events = await fetchAllEvents<StressEvent>('all_day_stress', fromMs, toMs);
    for (const event of events) {
      await upsertRawPayload(config.db, 'events_stress', String(event.timestamp), event);
      await upsertStressEvent(config.db, event, tzOffsetSec);
    }
    return { recordsSynced: events.length };
  }

  async function syncSpo2Events(fromMs: number, toMs: number): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('events_spo2');
    const events = await fetchAllEvents<Spo2Event>('blood_oxygen', fromMs, toMs);
    for (const event of events) {
      await upsertRawPayload(config.db, 'events_spo2', `${event.timestamp}:${event.subType}`, event);
      await upsertSpo2Event(config.db, event);
    }
    return { recordsSynced: events.length };
  }

  async function syncPaiEvents(fromMs: number, toMs: number): Promise<EndpointRunResult> {
    config.statusObservable.setSyncing('events_pai');
    const tzOffsetSec = await currentTzOffsetSec();
    const events = await fetchAllEvents<PaiEvent>('PaiHealthInfo', fromMs, toMs);
    for (const event of events) {
      await upsertRawPayload(config.db, 'events_pai', String(event.timestamp), event);
      await upsertPaiEvent(config.db, event, tzOffsetSec);
    }
    return { recordsSynced: events.length };
  }

  async function syncAll(range: SyncRange): Promise<SyncSummary> {
    const startedAt = Date.now();
    const results: SyncEndpointSummary[] = [];

    const endpoints: readonly { name: string; run: () => Promise<EndpointRunResult> }[] = [
      { name: 'devices', run: syncDevices },
      { name: 'band_data', run: () => syncBandData(range.fromDate, range.toDate) },
      { name: 'user_profile', run: syncUserProfile },
      { name: 'sport_run_history', run: syncWorkouts },
      { name: 'events_stress', run: () => syncStressEvents(range.fromMs, range.toMs) },
      { name: 'events_spo2', run: () => syncSpo2Events(range.fromMs, range.toMs) },
      { name: 'events_pai', run: () => syncPaiEvents(range.fromMs, range.toMs) },
    ];

    for (const endpoint of endpoints) {
      try {
        const result = await endpoint.run();
        results.push({
          endpoint: endpoint.name,
          recordsSynced: result.recordsSynced,
          ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
        });
        await setWatermark(config.db, endpoint.name, range.toDate);
      } catch (err) {
        // One endpoint failing shouldn't abort the whole sync — report it
        // and continue, so a transient stress-events outage doesn't also
        // block band_data/profile from syncing.
        config.statusObservable.setError(endpoint.name, err instanceof Error ? err.message : String(err));
      }
    }

    const summary: SyncSummary = { startedAt, finishedAt: Date.now(), endpoints: results };
    config.statusObservable.setDone(summary);
    return summary;
  }

  return {
    syncAll,
    syncDevices,
    syncBandData,
    syncUserProfile,
    syncWorkouts,
    syncStressEvents,
    syncSpo2Events,
    syncPaiEvents,
    status: config.statusObservable,
  };
}

export type ZeppApiService = ReturnType<typeof createZeppApiService>;

/** Convenience: detects the account's regional host once, for callers wiring up ZeppApiServiceConfig.apiHost. */
export async function resolveApiHost(transport: FetchLike, appToken: string, userId: string): Promise<string> {
  const { host } = await detectApiHost(transport, appToken, userId, {
    extraHeaders: {
      appname: 'com.xiaomi.hm.health',
      appplatform: 'android_phone',
      'User-Agent': 'MiFit/6.3.5 (Android)',
    },
  });
  return host;
}
