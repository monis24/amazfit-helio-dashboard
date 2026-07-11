/**
 * HuamiAuth.ts — standalone Huami/Zepp (Amazfit) OAuth2 login flow.
 *
 * Direct translation of the `argrento/huami-token` flow (cross-referenced against
 * `micw/hacking-mifit-api`, the most complete public documentation of the same
 * endpoints). This is legitimate credential extraction for one's OWN account —
 * the same access pattern Gadgetbridge uses for Huami-server pairing.
 *
 * The flow, in three steps:
 *   1. requestAccessToken()        email+password  -> short-lived `access` code
 *                                  (delivered in the Location header of a 30x
 *                                   redirect, alongside `country_code`).
 *   2. exchangeAccessForSession()  `access` code   -> `login_token` (long-lived,
 *                                  ~30d) + `app_token` (short-lived) + `user_id`.
 *   3. refreshAppToken()           `login_token`   -> a fresh `app_token`,
 *                                  WITHOUT a full password re-login.
 *
 * `app_token` is what authenticates subsequent data API calls. `login_token` is
 * the durable credential that lets us re-mint `app_token` when it expires.
 *
 * -------------------------------------------------------------------------
 * WHY THIS MODULE TAKES AN INJECTED HTTP TRANSPORT (the load-bearing design)
 * -------------------------------------------------------------------------
 * Step 1 depends on reading the `Location` header of a 30x redirect *without
 * following it*. Python's `requests` does this with `allow_redirects=False`.
 *
 * The equivalent is runtime-specific and NOT uniformly available:
 *   - Node (Phase 0 discovery script): undici `fetch` with `redirect: 'manual'`
 *     returns the real 3xx response with the `Location` header readable, OR use
 *     `node:https` directly. Either works — see createFetchTransport() below.
 *   - React Native / Expo (Phase 1): the built-in `fetch` follows redirects at
 *     the native networking layer (NSURLSession / OkHttp) and IGNORES
 *     `redirect: 'manual'`. A naive port therefore silently loses the `access`
 *     code — the redirect is followed to the S3 success page, the code never
 *     surfaces, and login fails with a confusing "no access token" rather than a
 *     clear network error. See TRANSPORT NOTES at the bottom for RN-safe options.
 *
 * So this module never calls `fetch` itself. It depends only on the HttpTransport
 * interface and requires the transport to honor `followRedirects: false` by
 * returning the raw 3xx (status + headers), never following it. Each runtime
 * supplies a transport that can actually do that.
 *
 * -------------------------------------------------------------------------
 * TWO SILENT-FAILURE TRAPS THIS MODULE GUARDS AGAINST
 * -------------------------------------------------------------------------
 *   (A) Wrong regional host returns HTTP 200 with empty data, not an error.
 *       The API host is region-specific (api-mifit-us2 / -de2 / cn). We derive
 *       the region from the login response (`region` field, else `country_code`)
 *       rather than assuming one. See resolveRegion() / HuamiSession.apiHost.
 *   (B) Some Huami endpoints return HTTP 200 with an error code in the JSON body
 *       (e.g. expired/invalid token). The login and refresh paths therefore check
 *       the parsed body's error fields, not just response.status. See
 *       assertNoBodyError().
 */

// ---------------------------------------------------------------------------
// HTTP transport abstraction (injected per runtime)
// ---------------------------------------------------------------------------

/** Case-insensitive header lookup. Both the WHATWG `Headers` object and a small
 *  hand-rolled shim satisfy this shape. */
export interface HeaderReader {
  get(name: string): string | null;
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Pre-encoded body (e.g. application/x-www-form-urlencoded). */
  readonly body?: string;
  /**
   * When false, a 3xx MUST be returned as-is (status + Location header) and MUST
   * NOT be transparently followed. The transport is responsible for honoring
   * this; the access-code step is meaningless otherwise.
   */
  readonly followRedirects: boolean;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: HeaderReader;
  /** Raw response body as text (may be empty for redirects). */
  readonly body: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Endpoint + client identity configuration. Defaults reproduce the classic
 * huami.com flow documented by huami-token / hacking-mifit-api. The current
 * huami-token package has migrated to `*.zepp.com` hosts and an AES-encrypted
 * initial payload; if the huami.com endpoints stop working, override
 * `tokensUrl` / `loginUrl` and see the ZEPP VARIANT note at the bottom.
 */
export interface HuamiAuthConfig {
  readonly transport: HttpTransport;

  /** Access-code endpoint. `{email}` is substituted (URL-encoded). */
  readonly tokensUrl?: string;
  /** Login / refresh endpoint. */
  readonly loginUrl?: string;

  /**
   * Stable per-install device identifier. MUST be stable across login and
   * subsequent refreshes for the same install — persist it (MMKV in Phase 1).
   * Defaults to the documented placeholder MAC; overriding with a stable UUID
   * is recommended.
   */
  readonly deviceId?: string;

  readonly appName?: string;
  readonly appVersion?: string;
  readonly deviceModel?: string;
  /** Comma-separated domain list the server echoes back; part of the contract. */
  readonly dn?: string;
  /** OAuth redirect target — must match what the tokens endpoint expects. */
  readonly redirectUri?: string;

  /**
   * Region -> API host builder. Override once you have confirmed your account's
   * real host (see trap A). Default: China -> api-mifit.huami.com,
   * everything else -> api-mifit-<region>.huami.com.
   */
  readonly buildApiHost?: (region: string) => string;
  /** country_code -> region resolver. Override if your region isn't mapped. */
  readonly resolveRegion?: (countryCode: string) => string;
}

const DEFAULTS = {
  tokensUrl: 'https://api-user.huami.com/registrations/{email}/tokens',
  loginUrl: 'https://account.huami.com/v2/client/login',
  deviceId: '02:00:00:00:00:00',
  appName: 'com.xiaomi.hm.health',
  appVersion: '6.3.5',
  deviceModel: 'android_phone',
  dn: 'account.huami.com,api-user.huami.com,api-watch.huami.com,api-analytics.huami.com,app-analytics.huami.com,api-mifit.huami.com',
  redirectUri: 'https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html',
} as const;

function resolveConfig(config: HuamiAuthConfig): Required<Omit<HuamiAuthConfig, 'transport'>> & { transport: HttpTransport } {
  return {
    transport: config.transport,
    tokensUrl: config.tokensUrl ?? DEFAULTS.tokensUrl,
    loginUrl: config.loginUrl ?? DEFAULTS.loginUrl,
    deviceId: config.deviceId ?? DEFAULTS.deviceId,
    appName: config.appName ?? DEFAULTS.appName,
    appVersion: config.appVersion ?? DEFAULTS.appVersion,
    deviceModel: config.deviceModel ?? DEFAULTS.deviceModel,
    dn: config.dn ?? DEFAULTS.dn,
    redirectUri: config.redirectUri ?? DEFAULTS.redirectUri,
    buildApiHost: config.buildApiHost ?? defaultBuildApiHost,
    resolveRegion: config.resolveRegion ?? defaultResolveRegion,
  };
}

// ---------------------------------------------------------------------------
// Region resolution (trap A)
// ---------------------------------------------------------------------------

/**
 * country_code -> Huami region slug. The mapping is intentionally small and
 * conservative: China gets its dedicated host, everything else defaults to the
 * `us2` (us-west-2) region that Huami uses as the non-China default. This is a
 * documented starting point, NOT authoritative for every country — override
 * `resolveRegion` in config once you confirm your account's real host, because
 * guessing wrong yields HTTP-200-empty responses, not errors.
 */
export function defaultResolveRegion(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (cc === 'CN') return 'cn';
  if (cc === 'DE' || cc === 'AT' || cc === 'CH') return 'de2';
  return 'us2';
}

export function defaultBuildApiHost(region: string): string {
  // China's data host carries no region suffix; all others do.
  if (region === 'cn') return 'https://api-mifit.huami.com';
  return `https://api-mifit-${region}.huami.com`;
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Output of step 1 — the short-lived access grant carried by the redirect. */
export interface AccessGrant {
  readonly accessToken: string;
  readonly countryCode: string;
  /** Present in the newer flow's redirect; unused by the classic exchange. */
  readonly refreshToken?: string;
}

/** Output of step 2 — everything needed to call the data API and to refresh. */
export interface HuamiSession {
  readonly loginToken: string;
  readonly appToken: string;
  readonly userId: string;
  /** app_token lifetime in seconds (typically 2592000 = 30 days). */
  readonly appTokenTtlSeconds: number;
  readonly countryCode: string;
  readonly region: string;
  /** Region-specific data API host, e.g. https://api-mifit-us2.huami.com */
  readonly apiHost: string;
}

/** Output of step 3 — a refreshed app_token minted from a stored login_token. */
export interface RefreshedAppToken {
  readonly appToken: string;
  readonly appTokenTtlSeconds: number;
  readonly userId: string;
  readonly region: string;
  readonly apiHost: string;
  /**
   * The server MAY rotate the login_token on refresh. When it does, callers must
   * persist the new one; when it doesn't, this is undefined and the old
   * login_token remains valid.
   */
  readonly rotatedLoginToken?: string;
}

export interface HuamiCredentials {
  readonly email: string;
  readonly password: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type HuamiAuthStage = 'access' | 'login' | 'refresh';

export class HuamiAuthError extends Error {
  readonly stage: HuamiAuthStage;
  /** Server-provided error code, when the failure was a body-level error. */
  readonly code: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(
    stage: HuamiAuthStage,
    message: string,
    opts?: { code?: string | undefined; httpStatus?: number | undefined },
  ) {
    super(`[huami:${stage}] ${message}`);
    this.name = 'HuamiAuthError';
    this.stage = stage;
    this.code = opts?.code;
    this.httpStatus = opts?.httpStatus;
    // Restore prototype chain (TS target < ES2015 or transpiled class extends).
    Object.setPrototypeOf(this, HuamiAuthError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — request the access code from the login redirect
// ---------------------------------------------------------------------------

/**
 * POSTs credentials to the tokens endpoint and reads the `access` code + region
 * `country_code` out of the 30x redirect's Location header.
 *
 * Relies on `followRedirects: false`. If the injected transport follows the
 * redirect anyway (the RN default-fetch trap), this throws a clear error rather
 * than failing mysteriously downstream.
 */
export async function requestAccessToken(
  credentials: HuamiCredentials,
  config: HuamiAuthConfig,
): Promise<AccessGrant> {
  const cfg = resolveConfig(config);
  const url = cfg.tokensUrl.replace('{email}', encodeURIComponent(credentials.email));

  const body = encodeForm({
    state: 'REDIRECTION',
    client_id: 'HuaMi',
    password: credentials.password,
    redirect_uri: cfg.redirectUri,
    token: 'access',
    // country_code is echoed back in the redirect; we don't need to send it.
  });

  const response = await cfg.transport({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MiFit/6.3.5 (Android)',
    },
    body,
    followRedirects: false,
  });

  if (response.status < 300 || response.status >= 400) {
    // A 2xx here almost always means the transport followed the redirect (RN
    // trap) or the credentials were rejected without a redirect being issued.
    throw new HuamiAuthError(
      'access',
      `expected a 30x redirect carrying the access code, got HTTP ${response.status}. ` +
        `If this is React Native, the transport is following redirects natively and ` +
        `discarding the Location header — inject a redirect-manual-capable transport.`,
      { httpStatus: response.status },
    );
  }

  const location = response.headers.get('location') ?? response.headers.get('Location');
  if (location === null || location.length === 0) {
    throw new HuamiAuthError('access', 'redirect response had no Location header', {
      httpStatus: response.status,
    });
  }

  const params = parseQueryString(location);
  const accessToken = params.get('access');
  const countryCode = params.get('country_code');

  if (accessToken === undefined || accessToken.length === 0) {
    // The redirect may instead carry an `error`/`error_description` param.
    const err = params.get('error') ?? params.get('error_description');
    throw new HuamiAuthError('access', `no access code in redirect${err !== undefined ? `: ${err}` : ''}`, {
      httpStatus: response.status,
    });
  }
  if (countryCode === undefined || countryCode.length === 0) {
    throw new HuamiAuthError(
      'access',
      'redirect carried no country_code — cannot determine the regional host (trap A)',
      { httpStatus: response.status },
    );
  }

  const refreshToken = params.get('refresh');
  return {
    accessToken,
    countryCode,
    ...(refreshToken !== undefined && refreshToken.length > 0 ? { refreshToken } : {}),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — exchange the access code for a durable session
// ---------------------------------------------------------------------------

export async function exchangeAccessForSession(
  grant: AccessGrant,
  config: HuamiAuthConfig,
): Promise<HuamiSession> {
  const cfg = resolveConfig(config);

  const body = encodeForm({
    app_name: cfg.appName,
    app_version: cfg.appVersion,
    code: grant.accessToken,
    country_code: grant.countryCode,
    device_id: cfg.deviceId,
    device_model: cfg.deviceModel,
    grant_type: 'access_token',
    third_name: 'huami',
    source: cfg.appName,
    dn: cfg.dn,
    allow_registration: 'false',
    lang: 'en',
    os_version: '1.5.0',
  });

  const parsed = await postLogin('login', cfg, body);
  const tokenInfo = extractTokenInfo('login', parsed);

  const region = resolveSessionRegion(cfg, tokenInfo, grant.countryCode);
  return {
    loginToken: tokenInfo.loginToken,
    appToken: tokenInfo.appToken,
    userId: tokenInfo.userId,
    appTokenTtlSeconds: tokenInfo.appTtl,
    countryCode: grant.countryCode,
    region,
    apiHost: cfg.buildApiHost(region),
  };
}

// ---------------------------------------------------------------------------
// Convenience: full password login (step 1 + step 2)
// ---------------------------------------------------------------------------

export async function login(credentials: HuamiCredentials, config: HuamiAuthConfig): Promise<HuamiSession> {
  const grant = await requestAccessToken(credentials, config);
  return exchangeAccessForSession(grant, config);
}

// ---------------------------------------------------------------------------
// Step 3 — refresh app_token from a stored login_token (no password)
// ---------------------------------------------------------------------------

/**
 * Re-mints a fresh `app_token` from a stored `login_token` using
 * grant_type=refresh_token. This is the routine re-auth path — it avoids a full
 * password login for the common case of an expired (but not revoked) app_token.
 *
 * `countryCode` is required because the login_token alone does not carry the
 * region, and the refreshed app_token must be used against the correct regional
 * host (trap A). Persist the country_code from the original login alongside the
 * login_token.
 */
export async function refreshAppToken(
  loginToken: string,
  countryCode: string,
  config: HuamiAuthConfig,
): Promise<RefreshedAppToken> {
  const cfg = resolveConfig(config);

  const body = encodeForm({
    app_name: cfg.appName,
    app_version: cfg.appVersion,
    code: loginToken, // for refresh_token grant, `code` carries the login_token
    country_code: countryCode,
    device_id: cfg.deviceId,
    device_model: cfg.deviceModel,
    grant_type: 'refresh_token',
    third_name: 'huami',
    source: cfg.appName,
    dn: cfg.dn,
    allow_registration: 'false',
    lang: 'en',
    os_version: '1.5.0',
  });

  const parsed = await postLogin('refresh', cfg, body);
  const tokenInfo = extractTokenInfo('refresh', parsed, { loginTokenOptional: true });

  const region = resolveSessionRegion(cfg, tokenInfo, countryCode);
  return {
    appToken: tokenInfo.appToken,
    appTokenTtlSeconds: tokenInfo.appTtl,
    userId: tokenInfo.userId,
    region,
    apiHost: cfg.buildApiHost(region),
    ...(tokenInfo.loginToken.length > 0 && tokenInfo.loginToken !== loginToken
      ? { rotatedLoginToken: tokenInfo.loginToken }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal: shared login POST + body-error checking (trap B)
// ---------------------------------------------------------------------------

async function postLogin(
  stage: HuamiAuthStage,
  cfg: ReturnType<typeof resolveConfig>,
  body: string,
): Promise<Record<string, unknown>> {
  const response = await cfg.transport({
    method: 'POST',
    url: cfg.loginUrl,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MiFit/6.3.5 (Android)',
    },
    body,
    // The login endpoint responds 200 with JSON; no redirect to preserve here.
    followRedirects: true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new HuamiAuthError(stage, `login endpoint returned HTTP ${response.status}`, {
      httpStatus: response.status,
    });
  }

  const parsed = parseJsonObject(stage, response.body, response.status);
  // Trap B: HTTP 200 can still carry a body-level error (e.g. invalid/expired
  // token, bad code). Check the body before trusting the status.
  assertNoBodyError(stage, parsed, response.status);
  return parsed;
}

/**
 * Huami signals body-level failure in a few shapes across endpoints. Treat any
 * of them as an error even though the HTTP status was 200:
 *   - `error_code` / `error` present (login/auth endpoints)
 *   - `result` present and not "ok"
 *   - `code` present and not the success sentinel (1) on data-style responses
 */
function assertNoBodyError(stage: HuamiAuthStage, parsed: Record<string, unknown>, httpStatus: number): void {
  const errorCode = readString(parsed['error_code']);
  const errorMsg = readString(parsed['error']);
  if (errorCode !== undefined || errorMsg !== undefined) {
    throw new HuamiAuthError(stage, `server error in 200 body: ${errorMsg ?? errorCode ?? 'unknown'}`, {
      code: errorCode,
      httpStatus,
    });
  }

  const result = readString(parsed['result']);
  if (result !== undefined && result.toLowerCase() !== 'ok') {
    throw new HuamiAuthError(stage, `server reported result="${result}" in 200 body`, {
      code: result,
      httpStatus,
    });
  }

  // `code` is only meaningful when present and numeric; 1 is Huami's success.
  const code = parsed['code'];
  if (typeof code === 'number' && code !== 1) {
    throw new HuamiAuthError(stage, `server reported code=${code} in 200 body`, {
      code: String(code),
      httpStatus,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal: token_info parsing (strict, no `any`)
// ---------------------------------------------------------------------------

interface ParsedTokenInfo {
  readonly loginToken: string;
  readonly appToken: string;
  readonly userId: string;
  readonly appTtl: number;
  readonly region?: string;
}

function extractTokenInfo(
  stage: HuamiAuthStage,
  parsed: Record<string, unknown>,
  opts?: { loginTokenOptional?: boolean },
): ParsedTokenInfo {
  const rawTokenInfo = parsed['token_info'];
  if (!isRecord(rawTokenInfo)) {
    // A 200 with no token_info is the wrong-host / rejected-code failure mode.
    throw new HuamiAuthError(stage, 'response had no token_info object (wrong host or rejected code?)');
  }

  const appToken = readString(rawTokenInfo['app_token']);
  const userId = readStringOrNumber(rawTokenInfo['user_id']);
  const loginToken = readString(rawTokenInfo['login_token']);

  if (appToken === undefined) {
    throw new HuamiAuthError(stage, 'token_info missing app_token');
  }
  if (userId === undefined) {
    throw new HuamiAuthError(stage, 'token_info missing user_id');
  }
  if (loginToken === undefined && opts?.loginTokenOptional !== true) {
    throw new HuamiAuthError(stage, 'token_info missing login_token');
  }

  const appTtl = readNumberOrNumericString(rawTokenInfo['app_ttl']) ?? 2592000;
  const region = readString(rawTokenInfo['region']);

  return {
    loginToken: loginToken ?? '',
    appToken,
    userId,
    appTtl,
    ...(region !== undefined ? { region } : {}),
  };
}

function resolveSessionRegion(
  cfg: ReturnType<typeof resolveConfig>,
  tokenInfo: ParsedTokenInfo,
  countryCode: string,
): string {
  // Prefer an explicit region from the server; fall back to mapping the
  // country_code. Never assume a fixed default (trap A).
  if (tokenInfo.region !== undefined && tokenInfo.region.length > 0) {
    return tokenInfo.region;
  }
  return cfg.resolveRegion(countryCode);
}

// ---------------------------------------------------------------------------
// Internal: small dependency-free helpers (RN + Node safe)
// ---------------------------------------------------------------------------

function encodeForm(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * Parses the query string out of a (possibly absolute) URL or Location header.
 * Hand-rolled rather than using URL/URLSearchParams to avoid constructor edge
 * cases with the S3 redirect_uri and to stay dependency-free across runtimes.
 * Returns a Map so callers can distinguish "absent" (undefined) from "empty".
 */
export function parseQueryString(urlOrLocation: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const qIndex = urlOrLocation.indexOf('?');
  const query = qIndex >= 0 ? urlOrLocation.slice(qIndex + 1) : urlOrLocation;
  const hashIndex = query.indexOf('#');
  const clean = hashIndex >= 0 ? query.slice(0, hashIndex) : query;
  if (clean.length === 0) return out;

  for (const pair of clean.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawVal = eq >= 0 ? pair.slice(eq + 1) : '';
    out.set(safeDecode(rawKey), safeDecode(rawVal));
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseJsonObject(stage: HuamiAuthStage, body: string, httpStatus: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new HuamiAuthError(stage, `response body was not valid JSON (len=${body.length})`, {
      httpStatus,
    });
  }
  if (!isRecord(parsed)) {
    throw new HuamiAuthError(stage, 'response body was not a JSON object', { httpStatus });
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringOrNumber(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function readNumberOrNumericString(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Optional transport helper for fetch-based runtimes (Node discovery script)
// ---------------------------------------------------------------------------

/** Minimal structural type for a WHATWG-ish fetch, so we don't depend on lib.dom. */
export interface FetchLike {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      redirect: 'follow' | 'manual';
    },
  ): Promise<{
    status: number;
    headers: HeaderReader;
    text(): Promise<string>;
  }>;
}

/**
 * Wraps a fetch implementation into an HttpTransport.
 *
 * CORRECTNESS PRECONDITION: under `redirect: 'manual'`, the supplied fetch must
 * return the REAL 3xx response with a readable `Location` header.
 *   - Node's undici `fetch` satisfies this (it does NOT opaque-filter manual
 *     redirects the way browsers do) — good for the Phase 0 discovery script.
 *   - Browser fetch and React Native's built-in fetch do NOT — they return an
 *     opaque redirect (status 0, no Location) or follow it natively. Do not use
 *     this helper there; inject a native/low-level transport instead
 *     (see TRANSPORT NOTES).
 */
export function createFetchTransport(fetchImpl: FetchLike): HttpTransport {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: request.followRedirects ? 'follow' : 'manual',
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text };
  };
}

/*
 * -------------------------------------------------------------------------
 * TRANSPORT NOTES
 * -------------------------------------------------------------------------
 * Phase 0 (Node discovery script):
 *   import { createFetchTransport } from './HuamiAuth';
 *   const transport = createFetchTransport(fetch); // Node 18+ global undici fetch
 *   // or, for maximum certainty, a node:https wrapper that reads res.headers.location.
 *
 * Phase 1 (React Native / Expo bare):
 *   The built-in `fetch` cannot do manual redirects. Options, in order of
 *   preference — the first that is verified on-device wins:
 *     1. Expo's `expo/fetch` (WinterCG fetch) IF it honors `redirect: 'manual'`
 *        on this SDK — VERIFY before relying on it; if it does, wrap it with
 *        createFetchTransport.
 *     2. A thin native transport over NSURLSession (iOS) using a
 *        URLSessionTaskDelegate that returns nil from the
 *        `willPerformHTTPRedirection` callback, exposing the 3xx + Location to JS.
 *     3. A community HTTP module that surfaces redirect responses
 *        (e.g. react-native-blob-util's `followRedirect(false)`), adapted to the
 *        HttpTransport shape.
 *   Whichever is chosen, it MUST return the raw 3xx for followRedirects:false.
 *
 * -------------------------------------------------------------------------
 * ZEPP VARIANT (if huami.com endpoints are decommissioned)
 * -------------------------------------------------------------------------
 * The current huami-token package targets:
 *   tokensUrl: https://api-user-us2.zepp.com/v2/registrations/tokens  (POST,
 *              body carries emailOrPhone + password, AES-encrypted with a
 *              hardcoded key/IV, and the 303 redirect returns `access`+`refresh`)
 *   loginUrl:  https://api-mifit-us2.zepp.com/v2/client/login
 * That variant hardcodes the us2 region and adds a payload-encryption step this
 * module does not implement. If you must switch, override tokensUrl/loginUrl and
 * add an encrypt hook to requestAccessToken's body construction.
 */
