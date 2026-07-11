import { createZeppApiService, resolveApiHost, type ZeppApiServiceConfig } from '../ZeppApiService';
import { SyncStatusObservable } from '../SyncStatusObservable';
import { InMemoryTokenStore, TOKEN_KEYS } from '../TokenStore';
import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import type { SqliteDatabase } from '../../db/Database';
import type { HuamiAuthConfig } from '../HuamiAuth';

interface FakeHttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

interface RouterResponse {
  readonly status: number;
  text(): Promise<string>;
  readonly headers: { get(name: string): string | null };
}

/**
 * Routes fake HTTP calls by URL substring; each route serves a queue of
 * canned responses (last one repeats). Deliberately untyped against FetchLike
 * or HttpTransport here — the inferred richer return type (status+text+
 * headers) is structurally assignable to both narrower interfaces, so the
 * same fake serves ZeppApiService's data calls and HuamiAuth's refresh call.
 */
class FakeRouter {
  readonly calls: string[] = [];
  private readonly routes: { matcher: string; responses: FakeHttpResponse[]; index: number }[] = [];

  on(matcher: string, ...responses: FakeHttpResponse[]): this {
    this.routes.push({ matcher, responses, index: 0 });
    return this;
  }

  countFor(matcher: string): number {
    return this.calls.filter((u) => u.includes(matcher)).length;
  }

  transport = async (url: string): Promise<RouterResponse> => {
    this.calls.push(url);
    const route = this.routes.find((r) => url.includes(r.matcher));
    if (route === undefined) {
      throw new Error(`FakeRouter: no route registered for ${url}`);
    }
    const response = route.responses[Math.min(route.index, route.responses.length - 1)] as FakeHttpResponse;
    route.index += 1;
    return {
      status: response.status,
      text: async () => response.body,
      headers: {
        get: (name: string) => response.headers?.[name.toLowerCase()] ?? null,
      },
    };
  };
}

function ok(body: unknown): FakeHttpResponse {
  return { status: 200, body: JSON.stringify(body) };
}

const USER_ID = '3096033568';

function buildProfile() {
  return {
    userId: USER_ID,
    nickName: 'mm',
    applicationName: 'com.xiaomi.hm.health',
    applicationPlatform: 'ios_phone',
    birthday: '2001-03',
    createTime: 1,
    gender: 1,
    height: 185,
    idSource: 'huami',
    lastUpdateTime: 1,
    weight: 90,
    preferredLanguage: 'en_US',
    userOldProfile: { nickName: 'mm' },
    defaultFields: [],
  };
}

function buildHuamiAuthConfig(router: FakeRouter): HuamiAuthConfig {
  return {
    transport: async (request) => {
      const result = await router.transport(request.url);
      return { status: result.status, headers: result.headers, body: await result.text() };
    },
  };
}

describe('ZeppApiService', () => {
  let db: SqliteDatabase;
  let router: FakeRouter;
  let tokenStore: InMemoryTokenStore;
  let statusObservable: SyncStatusObservable;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
    router = new FakeRouter();
    tokenStore = new InMemoryTokenStore();
    statusObservable = new SyncStatusObservable();
    await tokenStore.setItem(TOKEN_KEYS.appToken, 'initial-app-token');
    await tokenStore.setItem(TOKEN_KEYS.loginToken, 'a-login-token');
    await tokenStore.setItem(TOKEN_KEYS.countryCode, 'US');
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  function buildConfig(overrides: Partial<ZeppApiServiceConfig> = {}): ZeppApiServiceConfig {
    return {
      transport: router.transport,
      db,
      tokenStore,
      userId: USER_ID,
      apiHost: 'https://api-mifit-us2.zepp.com',
      statusObservable,
      huamiAuthConfig: buildHuamiAuthConfig(router),
      baseDelayMs: 1, // keep tests fast
      ...overrides,
    };
  }

  it('syncWorkouts handles the confirmed-live "zero workouts" response without erroring', async () => {
    router.on('/v1/sport/run/history.json', ok({ code: 1, message: 'success', data: { next: -1, summary: [] } }));
    const service = createZeppApiService(buildConfig());

    const result = await service.syncWorkouts();
    expect(result.recordsSynced).toBe(0);
  });

  it('syncWorkouts paginates via the trackid cursor and persists raw + typed rows per workout', async () => {
    router
      // The more specific (paginated) route must be registered before the
      // bare-path one, since FakeRouter matches by substring and the bare
      // path is a substring of the paginated URL too.
      .on(
        '/v1/sport/run/history.json?trackid=555',
        ok({
          code: 1,
          message: 'success',
          data: { next: -1, summary: [{ trackid: 't2', source: 'src1', avg_heart_rate: 150 }] },
        }),
      )
      .on(
        '/v1/sport/run/history.json',
        ok({
          code: 1,
          message: 'success',
          data: { next: 555, summary: [{ trackid: 't1', source: 'src1', avg_heart_rate: 140 }] },
        }),
      );

    const service = createZeppApiService(buildConfig());
    const result = await service.syncWorkouts();

    expect(result.recordsSynced).toBe(2);
    const rows = await db.getAllAsync<{ track_id: string }>('SELECT track_id FROM workout_summaries ORDER BY track_id');
    expect(rows.map((r) => r.track_id)).toEqual(['t1', 't2']);
    const raw = await db.getAllAsync('SELECT * FROM raw_payloads WHERE endpoint = ?', ['sport_run_history']);
    expect(raw).toHaveLength(2);
  });

  it('syncUserProfile fetches, persists raw + typed rows, and reports syncing status', async () => {
    router.on('/users/3096033568', ok(buildProfile()));
    const service = createZeppApiService(buildConfig());

    const statuses: unknown[] = [];
    statusObservable.subscribe((s) => statuses.push(s));

    const result = await service.syncUserProfile();
    expect(result.recordsSynced).toBe(1);

    const row = await db.getFirstAsync<{ birthday: string; height_cm: number }>(
      'SELECT birthday, height_cm FROM user_profile WHERE user_id = ?',
      [USER_ID],
    );
    expect(row).toEqual({ birthday: '2001-03', height_cm: 185 });

    const raw = await db.getFirstAsync('SELECT * FROM raw_payloads WHERE endpoint = ?', ['user_profile']);
    expect(raw).not.toBeNull();

    expect(statuses).toContainEqual({ phase: 'syncing', endpoint: 'user_profile' });
  });

  it('syncDevices persists one raw_payloads row per device, keyed by deviceId', async () => {
    router.on(
      '/users/3096033568/devices',
      ok({
        items: [
          { deviceId: 'FBE94AFFFE6B7786', deviceType: 1, firmwareVersion: '1.2.3' },
          { deviceId: 'AAAA1111BBBB2222', deviceType: 1, firmwareVersion: '1.2.3' },
        ],
      }),
    );
    const service = createZeppApiService(buildConfig());
    const result = await service.syncDevices();

    expect(result.recordsSynced).toBe(2);
    const rows = await db.getAllAsync<{ natural_key: string }>(
      'SELECT natural_key FROM raw_payloads WHERE endpoint = ? ORDER BY natural_key',
      ['devices'],
    );
    expect(rows.map((r) => r.natural_key)).toEqual(['AAAA1111BBBB2222', 'FBE94AFFFE6B7786']);
  });

  it('retries on a 500 and succeeds once the server recovers', async () => {
    router.on(
      '/users/3096033568',
      { status: 500, body: 'server error' },
      { status: 500, body: 'server error' },
      ok(buildProfile()),
    );
    const service = createZeppApiService(buildConfig({ maxAttempts: 5 }));

    const result = await service.syncUserProfile();
    expect(result.recordsSynced).toBe(1);
    expect(router.countFor('/users/3096033568')).toBe(3);
  });

  it('gives up after maxAttempts on persistent 500s', async () => {
    router.on('/users/3096033568', { status: 500, body: 'server error' });
    const service = createZeppApiService(buildConfig({ maxAttempts: 3 }));

    await expect(service.syncUserProfile()).rejects.toThrow(/500/);
    expect(router.countFor('/users/3096033568')).toBe(3);
  });

  it('treats a 200-with-error-code body as a failure (trap B) without retrying it as a network error', async () => {
    router.on('/users/3096033568', ok({ code: -2001, message: 'Not found' }));
    const service = createZeppApiService(buildConfig({ maxAttempts: 5 }));

    await expect(service.syncUserProfile()).rejects.toThrow(/code=-2001/);
    // Not retried like a 500 would be -- a body-level "not found" isn't transient.
    expect(router.countFor('/users/3096033568')).toBe(1);
  });

  it('on a 401, refreshes the app token once via HuamiAuth and retries the request', async () => {
    router
      .on('/users/3096033568', { status: 401, body: '' }, ok(buildProfile()))
      .on('/v2/client/login', ok({ token_info: { app_token: 'refreshed-token', login_token: 'a-login-token', user_id: USER_ID } }));

    const service = createZeppApiService(buildConfig());
    const result = await service.syncUserProfile();

    expect(result.recordsSynced).toBe(1);
    expect(await tokenStore.getItem(TOKEN_KEYS.appToken)).toBe('refreshed-token');
    expect(router.countFor('/users/3096033568')).toBe(2); // original 401 + retry after refresh
  });

  it('on a missing app token, goes straight to refresh instead of burning the retry budget', async () => {
    // A fresh store with no appToken set at all (as opposed to a 401 from a
    // present-but-expired token, covered by the test above).
    const noTokenStore = new InMemoryTokenStore();
    await noTokenStore.setItem(TOKEN_KEYS.loginToken, 'a-login-token');
    await noTokenStore.setItem(TOKEN_KEYS.countryCode, 'US');

    router
      .on('/users/3096033568', ok(buildProfile()))
      .on('/v2/client/login', ok({ token_info: { app_token: 'fresh-token', login_token: 'a-login-token', user_id: USER_ID } }));

    const service = createZeppApiService(buildConfig({ tokenStore: noTokenStore, maxAttempts: 5 }));
    const result = await service.syncUserProfile();

    expect(result.recordsSynced).toBe(1);
    expect(await noTokenStore.getItem(TOKEN_KEYS.appToken)).toBe('fresh-token');
    // Exactly one profile fetch (post-refresh) -- no wasted attempts fetching with no token at all.
    expect(router.countFor('/users/3096033568')).toBe(1);
    expect(router.countFor('/v2/client/login')).toBe(1);
  });

  it('retries a transient failure in the refresh call itself', async () => {
    router
      .on('/users/3096033568', { status: 401, body: '' }, ok(buildProfile()))
      .on(
        '/v2/client/login',
        { status: 500, body: 'refresh endpoint down' },
        ok({ token_info: { app_token: 'refreshed-after-retry', login_token: 'a-login-token', user_id: USER_ID } }),
      );

    const service = createZeppApiService(buildConfig({ maxAttempts: 5 }));
    const result = await service.syncUserProfile();

    expect(result.recordsSynced).toBe(1);
    expect(await tokenStore.getItem(TOKEN_KEYS.appToken)).toBe('refreshed-after-retry');
    expect(router.countFor('/v2/client/login')).toBe(2); // one 500, then a retried success
  });

  it('retries a transient failure that occurs on the post-refresh attempt, not just a single bare retry', async () => {
    router
      .on(
        '/users/3096033568',
        { status: 401, body: '' }, // triggers refresh
        { status: 500, body: 'still down' }, // post-refresh attempt #1 -- used to propagate unretried
        ok(buildProfile()), // post-refresh attempt #2, now covered by attemptWithRetry
      )
      .on('/v2/client/login', ok({ token_info: { app_token: 'refreshed-token', login_token: 'a-login-token', user_id: USER_ID } }));

    const service = createZeppApiService(buildConfig({ maxAttempts: 5 }));
    const result = await service.syncUserProfile();

    expect(result.recordsSynced).toBe(1);
    expect(router.countFor('/users/3096033568')).toBe(3);
  });

  it('paginates events to exhaustion, advancing from = lastSeenTimestamp + 1', async () => {
    const page1Items = Array.from({ length: 2 }, (_, i) => ({
      userId: USER_ID,
      eventType: 'all_day_stress',
      subType: 'all_day_stress',
      timestamp: 1000 + i,
      deviceType: '0',
      minStress: '1',
      maxStress: '2',
      avgStress: '1',
      mediumProportion: '0',
      relaxProportion: '0',
      highProportion: '0',
      normalProportion: '0',
      deviceSn: 's',
      deviceId: 'd',
      deviceSource: '1',
      deviceMac: 'm',
      data: '[]',
    }));
    const page2Items = [{ ...page1Items[0], timestamp: 1002 }];

    router
      .on('eventType=all_day_stress&limit=2&from=1000', ok({ items: page1Items }))
      .on('eventType=all_day_stress&limit=2&from=1002', ok({ items: page2Items }));

    const service = createZeppApiService(buildConfig({ eventsPageLimit: 2 }));
    const result = await service.syncStressEvents(1000, 2000);

    expect(result.recordsSynced).toBe(3); // 2 from page 1 (full page -> keep going) + 1 from page 2 (partial -> stop)
    const rows = await db.getAllAsync('SELECT * FROM stress_days ORDER BY day_ts_ms');
    expect(rows).toHaveLength(3); // 3 distinct timestamps (1000, 1001, 1002) -> 3 distinct day_ts_ms rows
  });

  it('sources stress/PAI local_date from the most recently synced band_data tz, not a hardcoded value', async () => {
    // Seed hr_days with a confirmed non-UTC tz offset, as band_data (which
    // syncAll always runs before events) would have.
    await db.runAsync(
      'INSERT INTO hr_days (local_date, source, device_id, tz_offset_sec, hr_minutes) VALUES (?, ?, ?, ?, ?)',
      ['2026-07-07', 111, 'dev1', -25200, Buffer.alloc(1440)],
    );
    const crossesUtcMidnight = Date.UTC(2026, 6, 7, 2, 0, 0); // 2026-07-06T19:00 local at UTC-7
    router.on('eventType=all_day_stress', ok({
      items: [
        {
          userId: USER_ID,
          eventType: 'all_day_stress',
          subType: 'all_day_stress',
          timestamp: crossesUtcMidnight,
          deviceType: '0',
          minStress: '1',
          maxStress: '2',
          avgStress: '1',
          mediumProportion: '0',
          relaxProportion: '0',
          highProportion: '0',
          normalProportion: '0',
          deviceSn: 's',
          deviceId: 'd',
          deviceSource: '1',
          deviceMac: 'm',
          data: '[]',
        },
      ],
    }));

    const service = createZeppApiService(buildConfig());
    await service.syncStressEvents(crossesUtcMidnight, crossesUtcMidnight);

    const day = await db.getFirstAsync<{ local_date: string }>(
      'SELECT local_date FROM stress_days WHERE day_ts_ms = ?',
      [crossesUtcMidnight],
    );
    expect(day!.local_date).toBe('2026-07-06'); // not '2026-07-07', which a UTC slice would give
  });

  it('syncAll continues past one endpoint failing and still syncs the others', async () => {
    router
      .on('/users/3096033568/events', { status: 500, body: 'down' }) // stress/spo2/pai all fail
      .on('/users/3096033568/devices', ok({ items: [] })) // registered before the profile route below --
      // FakeRouter matches by substring, and '/users/3096033568' is a
      // substring of the devices URL too, so the more specific route must
      // come first or syncDevices would silently get the profile's shape.
      .on('/users/3096033568', ok(buildProfile())) // profile succeeds
      .on('/v1/data/band_data.json', ok({ code: 1, message: 'success', data: [] })); // band_data succeeds (empty)

    const service = createZeppApiService(buildConfig({ maxAttempts: 1 }));
    const errors: unknown[] = [];
    statusObservable.subscribe((s) => {
      if (s.phase === 'error') errors.push(s);
    });

    const summary = await service.syncAll({ fromDate: '2026-07-07', toDate: '2026-07-10', fromMs: 0, toMs: 1000 });

    expect(errors.length).toBeGreaterThan(0); // at least the events endpoints failed
    const profileResult = summary.endpoints.find((e) => e.endpoint === 'user_profile');
    expect(profileResult).toEqual({ endpoint: 'user_profile', recordsSynced: 1 });

    // Failed endpoints must not have their watermark advanced.
    const watermark = await db.getFirstAsync('SELECT * FROM sync_state WHERE endpoint = ?', ['events_stress']);
    expect(watermark).toBeNull();
    const profileWatermark = await db.getFirstAsync('SELECT * FROM sync_state WHERE endpoint = ?', ['user_profile']);
    expect(profileWatermark).not.toBeNull();
  });

  it('surfaces a sleep anchoring-mismatch as a warning rather than silently swallowing it', async () => {
    // A summary record whose slp.st can never match the anchored first
    // segment -- the exact failure mode db/__tests__/bandData.test.ts covers
    // at the query-layer level; this verifies it propagates up through
    // syncBandData's result and syncAll's summary, not just a console.warn.
    const corruptSummary = {
      goal: 8000,
      algv: 'v',
      isMerged: 0,
      stp: { runCal: 0, cal: 0, conAct: 0, ncal: 0, ttl: 0, dis: 0, rn: 0, wk: 0, stage: [], runDist: 0 },
      tz: '-25200',
      v: 6,
      sn: 'TEST',
      iOS: 'v',
      slp: {
        pe: 0,
        wk: 0,
        wc: 0,
        ed: 999999999, // deliberately inconsistent with the anchored segments below
        ebt: 0,
        supNap: false,
        dp: 60,
        lb: 0,
        odd_stage: [],
        is: 2,
        stage: [{ start: 0, stop: 59, mode: 5 }],
        napSleepSource: 0,
        isMerged: 0,
        napAlgoVersion: 'v',
        supRem: true,
        lt: 0,
        rhr: 55,
        sleepScoreVersion: 'v',
        selected: 0,
        ps: 0,
        dt: 0,
        ss: 0,
        sleepAlgoVersion: 'v',
        st: 1,
        sleepSource: 0,
      },
      hr: { maxHr: { hr: 0, ts: 0 } },
      byteLength: 8,
      sync: 0,
    };
    const summaryRecord = {
      uid: 'u1',
      data_type: 0,
      date_time: '2026-07-07',
      source: 111,
      summary: Buffer.from(JSON.stringify(corruptSummary), 'utf-8').toString('base64'),
      device_id: 'dev1',
      uuid: 'uuid1',
      data: Buffer.from([0]).toString('base64'),
      data_hr: Buffer.from(Array(1440).fill(70)).toString('base64'),
    };

    router
      .on(
        'query_type=detail',
        ok({ code: 1, message: 'success', data: [] }),
      )
      .on('query_type=summary', ok({ code: 1, message: 'success', data: [summaryRecord] }));

    const service = createZeppApiService(buildConfig());
    const result = await service.syncBandData('2026-07-07', '2026-07-07');

    expect(result.recordsSynced).toBe(1);
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toMatch(/anchoring mismatch for 2026-07-07/);

    // The activity side of the same record still persists independently of
    // the sleep anchoring failure -- one bad field shouldn't block the rest.
    const activity = await db.getFirstAsync('SELECT * FROM activity_days WHERE local_date = ?', ['2026-07-07']);
    expect(activity).not.toBeNull();
    const session = await db.getFirstAsync('SELECT * FROM sleep_sessions WHERE local_date = ?', ['2026-07-07']);
    expect(session).toBeNull();

    // And it's visible through syncAll's summary, not just a console.warn.
    router.on('/users/3096033568', ok(buildProfile())).on('/users/3096033568/events', ok({ items: [] }));
    const summary = await service.syncAll({ fromDate: '2026-07-07', toDate: '2026-07-07', fromMs: 0, toMs: 1 });
    const bandDataResult = summary.endpoints.find((e) => e.endpoint === 'band_data');
    expect(bandDataResult?.warnings?.[0]).toMatch(/anchoring mismatch/);
  });
});

describe('resolveApiHost', () => {
  it('delegates to detectApiHost and returns just the host', async () => {
    const router = new FakeRouter();
    router.on('/users/u1/devices', ok({ items: [{ deviceId: 'd1' }] }));
    const host = await resolveApiHost(router.transport, 'tok', 'u1');
    expect(host).toBe('https://api-mifit-us2.zepp.com');
  });
});
