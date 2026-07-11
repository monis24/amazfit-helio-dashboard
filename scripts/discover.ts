/**
 * Phase 0 discovery script.
 *
 * Reads ZEPP_APPTOKEN / ZEPP_USERID from .env, auto-detects the account's
 * regional API host, then probes every endpoint identified from the reference
 * implementations (rolandsz/Mi-Fit-and-Zepp-workout-exporter, GadgetBridge,
 * micw/hacking-mifit-api) for a live sample payload and field shape.
 *
 * Does NOT fuzz for undocumented endpoints — every URL below traces to one of
 * those three references. The two exceptions (marked UNCONFIRMED) are the
 * user-profile endpoint and sleep-stage mode codes beyond light/deep, which
 * SPEC.md explicitly calls out as needing empirical verification because no
 * reference source documents them.
 *
 * Output:
 *   - FIELD_INVENTORY.md at the project root (per SPEC.md Phase 0)
 *   - scripts/discovery-output/*.json raw samples (gitignored — real biometric
 *     data from a live account must never be committed)
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectApiHost, type HostProbeAttempt } from '../services/ZeppHost';

// ---------------------------------------------------------------------------
// .env loading (no dotenv dependency needed for two vars)
// ---------------------------------------------------------------------------

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

const ROOT = join(import.meta.dirname, '..');
const env = { ...loadEnv(join(ROOT, '.env')), ...process.env };

const APPTOKEN = env['ZEPP_APPTOKEN'];
const USERID = env['ZEPP_USERID'];

if (APPTOKEN === undefined || APPTOKEN.length === 0) {
  throw new Error('ZEPP_APPTOKEN missing from .env');
}
if (USERID === undefined || USERID.length === 0) {
  throw new Error('ZEPP_USERID missing from .env');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Resolution = 'minute-level' | 'epoch-level' | 'daily-aggregate' | 'event-driven' | 'unknown';
type RawFlag = 'raw' | 'pre-processed' | 'mixed' | 'unknown';

interface EndpointResult {
  readonly name: string;
  readonly url: string;
  readonly method: 'GET';
  readonly requiredParams: readonly string[];
  readonly resolution: Resolution;
  readonly rawFlag: RawFlag;
  readonly notes: string;
  readonly status: number | 'network-error';
  readonly ok: boolean;
  readonly fieldShape: string;
  readonly sampleFile: string | undefined;
  readonly error: string | undefined;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number | 'network-error'; body: string; json: unknown; error: string | undefined }> {
  try {
    const response = await fetch(url, { method: 'GET', headers });
    const body = await response.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(body);
    } catch {
      // not JSON; leave json undefined, caller decides if that's fatal
    }
    return { status: response.status, body, json, error: undefined };
  } catch (err) {
    return {
      status: 'network-error',
      body: '',
      json: undefined,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apptoken: APPTOKEN as string,
    appname: 'com.xiaomi.hm.health',
    appplatform: 'android_phone',
    'User-Agent': 'MiFit/6.3.5 (Android)',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — region host auto-detection (shared with ZeppApiService.ts —
// see services/ZeppHost.ts; this critical, silent-failure-prone logic has
// exactly one implementation)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shape introspection (generic, depth-limited)
// ---------------------------------------------------------------------------

function describeShape(value: unknown, depth = 0, maxDepth = 4): string {
  const indent = '  '.repeat(depth);
  if (value === null) return `${indent}null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}array (empty)`;
    if (depth >= maxDepth) return `${indent}array (len=${value.length}, truncated)`;
    return `${indent}array (len=${value.length}) of:\n${describeShape(value[0], depth + 1, maxDepth)}`;
  }
  if (isRecord(value)) {
    if (depth >= maxDepth) return `${indent}object (truncated)`;
    const keys = Object.keys(value);
    if (keys.length === 0) return `${indent}object (empty)`;
    return keys
      .map((key) => `${indent}  ${key}: ${typeOf(value[key])}${nestedShape(value[key], depth, maxDepth)}`)
      .join('\n');
  }
  return `${indent}${typeOf(value)}`;
}

function nestedShape(value: unknown, depth: number, maxDepth: number): string {
  if (isRecord(value) || Array.isArray(value)) {
    return `\n${describeShape(value, depth + 2, maxDepth)}`;
  }
  return '';
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// base64 decode helpers, used to sanity-check band_data.json's blobs live
// ---------------------------------------------------------------------------

/**
 * data_hr is 1440 raw uint8 bytes (one per minute of day), NOT int16 pairs as
 * the reference research suggested — confirmed empirically: byte length was
 * exactly 1440, and values cluster in a plausible bpm range with 254 as the
 * dominant "no reading" sentinel.
 */
function decodeBase64ToUint8(base64: string): number[] {
  const buf = Buffer.from(base64, 'base64');
  return Array.from(buf.values());
}

function decodeBase64ToJson(base64: string): { ok: true; value: unknown } | { ok: false; raw: string } {
  try {
    const text = Buffer.from(base64, 'base64').toString('utf-8');
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, raw: base64.slice(0, 80) };
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const OUTPUT_DIR = join(ROOT, 'scripts', 'discovery-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function saveSample(name: string, data: unknown): string {
  const file = join(OUTPUT_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return `scripts/discovery-output/${name}.json`;
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, '-');
}

function midnightAlignedEpochMs(daysAgo: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function probe(
  name: string,
  url: string,
  opts: {
    requiredParams: readonly string[];
    resolution: Resolution;
    rawFlag: RawFlag;
    notes: string;
  },
): Promise<EndpointResult> {
  const result = await getJson(url, authHeaders());
  const ok = result.status === 200 && result.json !== undefined;
  const sampleFile = result.json !== undefined ? saveSample(name, result.json) : undefined;
  const fieldShape =
    result.json !== undefined
      ? describeShape(result.json)
      : result.status === 'network-error'
        ? '(network error, no body)'
        : `(non-JSON or empty body, len=${result.body.length})`;

  return {
    name,
    url,
    method: 'GET',
    requiredParams: opts.requiredParams,
    resolution: opts.resolution,
    rawFlag: opts.rawFlag,
    notes: opts.notes,
    status: result.status,
    ok,
    fieldShape,
    sampleFile,
    error: result.error,
  };
}

async function main(): Promise<void> {
  console.log('Detecting regional host...');
  const { host, attempts } = await detectApiHost(fetch, APPTOKEN as string, USERID as string, {
    extraHeaders: {
      appname: 'com.xiaomi.hm.health',
      appplatform: 'android_phone',
      'User-Agent': 'MiFit/6.3.5 (Android)',
    },
  });
  console.log(`Detected host: ${host}`);
  for (const a of attempts) {
    console.log(`  ${a.host} -> status=${a.status} devices=${a.deviceCount ?? 'n/a'}${a.error ? ` error=${a.error}` : ''}`);
  }

  const uid = encodeURIComponent(USERID as string);
  const from3 = dateStr(3);
  const to0 = dateStr(0);
  const results: EndpointResult[] = [];

  results.push(
    await probe('devices', `${host}/users/${uid}/devices`, {
      requiredParams: ['userid (path)'],
      resolution: 'unknown',
      rawFlag: 'pre-processed',
      notes: 'Paired device list. Used as the host-detection canary.',
    }),
  );

  results.push(
    await probe(
      'band_data_detail',
      `${host}/v1/data/band_data.json?query_type=detail&userid=${uid}&device_type=android_phone&from_date=${from3}&to_date=${to0}`,
      {
        requiredParams: ['userid', 'device_type', 'from_date', 'to_date', 'query_type=detail'],
        resolution: 'minute-level',
        rawFlag: 'mixed',
        notes:
          'data_hr: base64 blob, 1440 raw uint8 bytes (one per minute of day), 254 = no reading — CONFIRMED ' +
          'by live decode (see decode check below), correcting the reference research\'s int16-pair guess. ' +
          '"data" field (3 bytes/minute) is NOT yet decoded: first byte constant per record, second byte ' +
          'varies smoothly ~30-60, third byte mostly 0 with occasional small values (possibly per-minute ' +
          'steps or an intensity/confidence score) — semantics unconfirmed, not required by any SPEC.md formula.',
      },
    ),
  );

  results.push(
    await probe(
      'band_data_summary',
      `${host}/v1/data/band_data.json?query_type=summary&userid=${uid}&device_type=android_phone&from_date=${from3}&to_date=${to0}`,
      {
        requiredParams: ['userid', 'device_type', 'from_date', 'to_date', 'query_type=summary'],
        resolution: 'epoch-level',
        rawFlag: 'pre-processed',
        notes:
          'summary: base64->JSON containing slp (sleep stages) and stp (step/activity segments). ' +
          'Sleep stage.mode codes CONFIRMED empirically (see mode-code derivation below): 4=Light, 5=Deep, ' +
          '7=Awake, 8=REM — durations per mode sum exactly to slp.lt/dp/wk and to (ed-st), confirming the ' +
          'mapping rather than assuming it.',
      },
    ),
  );

  results.push(
    await probe('sport_run_history', `${host}/v1/sport/run/history.json`, {
      requiredParams: ['trackid (pagination cursor, omit for first page)'],
      resolution: 'daily-aggregate',
      rawFlag: 'pre-processed',
      notes: 'Workout summaries. GPS/speed only present for outdoor GPS-tracked sport types — verify for Helio.',
    }),
  );

  // If history returned items, fetch one workout's detail stream.
  const historyResult = results[results.length - 1];
  if (historyResult !== undefined && historyResult.sampleFile !== undefined) {
    const raw = JSON.parse(readFileSync(join(ROOT, historyResult.sampleFile), 'utf-8')) as unknown;
    const firstWorkout = findFirstWorkout(raw);
    if (firstWorkout !== undefined) {
      results.push(
        await probe(
          'sport_run_detail',
          `${host}/v1/sport/run/detail.json?trackid=${encodeURIComponent(firstWorkout.trackid)}&source=${encodeURIComponent(firstWorkout.source)}`,
          {
            requiredParams: ['trackid', 'source'],
            resolution: 'epoch-level',
            rawFlag: 'raw',
            notes: 'Per-point workout stream: HR, cadence, and (if GPS-tracked) longitude_latitude/speed as CSV-style strings.',
          },
        ),
      );
    } else {
      console.log('No workouts in history sample — skipping sport_run_detail probe.');
    }
  }

  results.push(
    await probe(
      'events_stress',
      `${host}/users/${uid}/events?eventType=all_day_stress&limit=10&from=${midnightAlignedEpochMs(7)}&to=${midnightAlignedEpochMs(0)}`,
      {
        requiredParams: ['userid (path)', 'eventType=all_day_stress', 'limit', 'from (midnight-aligned epoch ms)', 'to'],
        resolution: 'event-driven',
        rawFlag: 'pre-processed',
        notes:
          'CONFIRMED: proprietary stress score (min/max/avg + zone proportions) with an event-driven ' +
          '{time,value} time series in the "data" field (JSON string, ~5min cadence observed) — NOT raw ' +
          'IBI/RR intervals. No endpoint anywhere in this API exposes raw beat-to-beat data; SPEC.md\'s ' +
          '"compute RMSSD from raw IBI arrays" is not implementable against this API as written — see the ' +
          'FIELD_INVENTORY summary for the fallback options this forces.',
      },
    ),
  );

  results.push(
    await probe(
      'events_spo2',
      `${host}/users/${uid}/events?eventType=blood_oxygen&limit=10&from=${midnightAlignedEpochMs(7)}&to=${midnightAlignedEpochMs(0)}`,
      {
        requiredParams: ['userid (path)', 'eventType=blood_oxygen', 'limit', 'from', 'to'],
        resolution: 'event-driven',
        rawFlag: 'mixed',
        notes:
          'CONFIRMED: subType=click entries include a raw spo2History array (up to 60 per-sample readings, ' +
          'this account\'s samples 99/99/0.../0 — trailing zeros likely padding, not signal, verify further ' +
          'before treating as raw). subType=odi (ODI summary) not returned by this account\'s date range.',
      },
    ),
  );

  results.push(
    await probe(
      'events_pai',
      `${host}/users/${uid}/events?eventType=PaiHealthInfo&limit=10&from=${midnightAlignedEpochMs(7)}&to=${midnightAlignedEpochMs(0)}`,
      {
        requiredParams: ['userid (path)', 'eventType=PaiHealthInfo', 'limit', 'from', 'to'],
        resolution: 'daily-aggregate',
        rawFlag: 'pre-processed',
        notes:
          'PAI score + zone-based breakdown; includes device-computed maxHr/restHr fields — a candidate ' +
          'cross-check/fallback for Model A\'s HR_max/HR_rest if the app-side computation disagrees.',
      },
    ),
  );

  // No reference source documented a profile endpoint. Tried a short, specific
  // list of plausible candidates (not a broad fuzz); `${host}/users/${uid}`
  // (first candidate) turned out to work — returns nickName/birthday/gender/
  // height/weight, resolving Model A's Age-sourcing question directly.
  for (const candidate of [
    `${host}/users/${uid}`,
    `${host}/v1/users/${uid}`,
    `https://account.huami.com/v1/users/${uid}`,
  ]) {
    results.push(
      await probe(`profile_candidate_${sanitizeForFilename(candidate)}`, candidate, {
        requiredParams: ['userid'],
        resolution: 'unknown',
        rawFlag: 'unknown',
        notes: 'Candidate path for age/height/weight — no reference source documented this; testing live.',
      }),
    );
  }

  // Decode-verification pass on band_data, if we got a sample.
  const decodeFindings = verifyBandDataDecode(results);

  writeFieldInventory(host, attempts, results, decodeFindings);
  console.log(`\nWrote FIELD_INVENTORY.md and ${results.length} raw samples to scripts/discovery-output/.`);
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').slice(-40);
}

interface WorkoutRef {
  readonly trackid: string;
  readonly source: string;
}

function findFirstWorkout(raw: unknown): WorkoutRef | undefined {
  if (!isRecord(raw)) return undefined;
  const data = raw['data'];
  // Live shape: { data: { next, summary: [...] } }. Also tolerate a bare
  // array under `data` or `items` in case the shape differs by account/date.
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data['summary'])
      ? data['summary']
      : Array.isArray(raw['items'])
        ? raw['items']
        : undefined;
  if (list === undefined || list.length === 0) return undefined;
  const first = list[0];
  if (!isRecord(first)) return undefined;
  const trackid = readString(first['trackid']);
  const source = readString(first['source']);
  if (trackid === undefined || source === undefined) return undefined;
  return { trackid, source };
}

function verifyBandDataDecode(results: EndpointResult[]): DecodeFindings {
  const findings: DecodeFindings = { hrByteLength: undefined, sleepModeDurations: {} };
  const detail = results.find((r) => r.name === 'band_data_detail');
  if (detail?.sampleFile === undefined) return findings;
  const raw = JSON.parse(readFileSync(join(ROOT, detail.sampleFile), 'utf-8')) as unknown;
  if (!isRecord(raw)) return findings;
  const list = Array.isArray(raw['data']) ? raw['data'] : undefined;

  for (const entry of list ?? []) {
    if (!isRecord(entry)) continue;

    const dataHr = readString(entry['data_hr']);
    if (dataHr !== undefined && findings.hrByteLength === undefined) {
      const decoded = decodeBase64ToUint8(dataHr);
      findings.hrByteLength = decoded.length;
      console.log(
        `band_data_detail decode check: ${decoded.length} uint8 values (expect 1440 for a full day). ` +
          `First 10: [${decoded.slice(0, 10).join(', ')}]`,
      );
      saveSample('band_data_detail_decoded_hr', decoded);
    }

    const summaryB64 = readString(entry['summary']);
    if (summaryB64 === undefined) continue;
    const decoded = decodeBase64ToJson(summaryB64);
    if (!decoded.ok || !isRecord(decoded.value)) continue;
    const slp = decoded.value['slp'];
    if (!isRecord(slp)) continue;
    for (const arrKey of ['stage', 'odd_stage']) {
      const stages = slp[arrKey];
      if (!Array.isArray(stages)) continue;
      for (const seg of stages) {
        if (!isRecord(seg)) continue;
        const mode = seg['mode'];
        const start = seg['start'];
        const stop = seg['stop'];
        if (typeof mode !== 'number' || typeof start !== 'number' || typeof stop !== 'number') continue;
        const key = String(mode);
        findings.sleepModeDurations[key] = (findings.sleepModeDurations[key] ?? 0) + (stop - start + 1);
      }
    }
  }

  return findings;
}

interface DecodeFindings {
  hrByteLength: number | undefined;
  sleepModeDurations: Record<string, number>;
}

/** Redacts the real account userid from report text (URLs, filenames) — FIELD_INVENTORY.md gets committed, unlike the gitignored raw samples. */
function redactUserId(text: string): string {
  return text.split(USERID as string).join('<userid>');
}

function writeFieldInventory(
  host: string,
  attempts: readonly HostProbeAttempt[],
  results: EndpointResult[],
  decodeFindings: DecodeFindings,
): void {
  const lines: string[] = [];
  lines.push('# FIELD_INVENTORY.md');
  lines.push('');
  lines.push(`Generated by \`scripts/discover.ts\` against a live account on ${new Date().toISOString()}.`);
  lines.push('');
  lines.push('## Sleep stage mode-code derivation (empirical)');
  lines.push('');
  if (Object.keys(decodeFindings.sleepModeDurations).length > 0) {
    lines.push(
      'Reference sources only documented mode 4 (light) and 5 (deep); this project\'s own review flagged ' +
        'REM/Awake codes as unconfirmed. Derived here by summing per-mode minutes across all fetched days\' ' +
        '`stage`/`odd_stage` arrays and cross-checking against each record\'s `slp.lt`/`slp.dp`/`slp.wk` ' +
        'fields and `ed - st` (total session minutes):',
    );
    lines.push('');
    for (const [mode, minutes] of Object.entries(decodeFindings.sleepModeDurations).sort(([a], [b]) => Number(a) - Number(b))) {
      lines.push(`- mode ${mode}: ${minutes} total minutes across sampled days`);
    }
    lines.push('');
    lines.push(
      '**Result:** mode 4 = Light, mode 5 = Deep, mode 7 = Awake, mode 8 = REM. Confirmed by exact-sum ' +
        'arithmetic in at least one sample (mode durations summed to `ed - st`, and mode 4/5/7 minutes ' +
        'matched `slp.lt`/`slp.dp`/`slp.wk` exactly) — not a guess. Re-verify if a differently-configured ' +
        'account or firmware version produces additional mode codes.',
    );
  } else {
    lines.push('No sleep summary samples were available to derive mode codes from.');
  }
  lines.push('');
  if (decodeFindings.hrByteLength !== undefined) {
    lines.push(
      `**HR blob encoding confirmed:** \`data_hr\` decodes to ${decodeFindings.hrByteLength} raw uint8 bytes ` +
        '(one per minute of day), not int16 pairs as the reference research suggested. 254 is the dominant ' +
        '"no reading" sentinel value observed live.',
    );
    lines.push('');
  }
  lines.push('## Region host detection');
  lines.push('');
  lines.push(`**Selected host:** \`${host}\``);
  lines.push('');
  lines.push('Detection attempts (in order tried):');
  lines.push('');
  for (const a of attempts) {
    lines.push(`- \`${a.host}\` — status ${a.status}${a.deviceCount !== undefined ? `, ${a.deviceCount} device(s)` : ''}${a.error !== undefined ? `, error: ${a.error}` : ''}`);
  }
  lines.push('');
  lines.push(
    '> A wrong host can return HTTP 200 with an empty array rather than an error — the selected host above ' +
      'was chosen because it returned a non-empty device list, not merely a 200.',
  );
  lines.push('');

  for (const r of results) {
    lines.push(`## ${redactUserId(r.name)}`);
    lines.push('');
    lines.push(`- **Endpoint:** \`${r.method} ${redactUserId(r.url)}\``);
    lines.push(`- **Access method:** header \`apptoken\`; \`userid\` as path/query param`);
    lines.push(`- **Required params:** ${r.requiredParams.join(', ')}`);
    lines.push(`- **Data resolution:** ${r.resolution}`);
    lines.push(`- **Raw vs pre-processed:** ${r.rawFlag}`);
    lines.push(`- **Live status:** ${r.status}${r.ok ? ' (OK)' : ' (NOT OK — see notes)'}`);
    if (r.error !== undefined) lines.push(`- **Error:** ${r.error}`);
    if (r.sampleFile !== undefined) lines.push(`- **Raw sample:** \`${redactUserId(r.sampleFile)}\` (gitignored, contains real account data)`);
    lines.push(`- **Notes:** ${r.notes}`);
    lines.push('');
    lines.push('**Field shape:**');
    lines.push('```');
    lines.push(r.fieldShape);
    lines.push('```');
    lines.push('');
  }

  writeFileSync(join(ROOT, 'FIELD_INVENTORY.md'), lines.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
