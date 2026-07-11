/**
 * ZeppApiSchemas.ts — strict wire-format types for the Huami/Zepp cloud API,
 * modeled from FIELD_INVENTORY.md (live account samples in
 * scripts/discovery-output/, generated 2026-07-10).
 *
 * Scope: this file models the RAW WIRE SHAPE returned by the cloud API,
 * including the base64/JSON-in-string sub-encodings, plus the decode
 * functions needed to turn those sub-encodings into typed values (the
 * decode + type-guard the "no unknown without a guard" rule requires).
 * It does not model domain concepts (VO2 Max, RMSSD, etc.) — those are
 * /engines' job, reading from /db, never from this file directly.
 *
 * PORTABILITY: base64/UTF-8 decoding below is hand-rolled, pure JS — no
 * Node `Buffer`, no `atob`/`TextDecoder` assumption — so this file runs
 * unmodified under Node (Phase 0/1 dev scripts, Jest) and React Native
 * (Phase 1 ZeppApiService.ts), matching HuamiAuth.ts's dependency-free
 * philosophy for its HTTP transport.
 */

// ---------------------------------------------------------------------------
// Shared envelope
// ---------------------------------------------------------------------------

export interface ZeppEnvelope<T> {
  readonly code: number;
  readonly message: string;
  readonly data: T;
}

// ---------------------------------------------------------------------------
// GET /users/{userid}/devices — CONFIRMED live
// ---------------------------------------------------------------------------

export interface DevicesResponse {
  readonly items: readonly DeviceInfo[];
}

export interface DeviceInfo {
  readonly deviceType: number;
  readonly deviceSource: number;
  readonly deviceId: string;
  readonly macAddress: string;
  readonly sn: string;
  readonly bindingStatus: number;
  readonly applicationTime: number;
  readonly lastStatusUpdateTime: number;
  readonly additionalInfo: string;
  readonly lastBindingPlatform: string;
  readonly firmwareVersion: string;
  readonly displayName: string;
  readonly lastActiveStatusUpdateTime: number;
  readonly activeStatus: number;
  readonly priority: string;
  readonly sort: number;
}

// ---------------------------------------------------------------------------
// GET /v1/data/band_data.json?query_type=detail|summary — CONFIRMED live
// ---------------------------------------------------------------------------

/** One record per day in the requested range. */
export interface BandDataRecord {
  readonly uid: string;
  readonly data_type: number;
  /** "YYYY-MM-DD" */
  readonly date_time: string;
  readonly source: number;
  /** base64 -> JSON; see decodeBandSummary(). */
  readonly summary: string;
  readonly device_id: string;
  readonly uuid: string;
  /**
   * base64, 3 bytes/minute (1440 minutes). Byte semantics NOT fully decoded:
   * first byte constant per record, second byte varies smoothly (~30-60),
   * third byte mostly 0 with occasional small values (possibly per-minute
   * steps or an intensity/confidence score). Not required by any Phase 2
   * formula — left as raw bytes rather than guessing a wrong meaning.
   */
  readonly data: string;
  /** base64 -> 1440 raw uint8 bytes, one per minute of day. See decodeHrMinutes(). */
  readonly data_hr: string;
}

export type BandDataResponse = ZeppEnvelope<readonly BandDataRecord[]>;

/** HR sentinel: this byte value means "no reading for that minute." */
export const HR_NO_READING_SENTINEL = 254;

/**
 * Decodes data_hr into 1440 per-minute HR readings (bpm). Confirmed live:
 * byte length was exactly 1440 for a full day (uint8, not int16 pairs as
 * older reverse-engineering write-ups suggested).
 */
export function decodeHrMinutes(dataHrBase64: string): readonly number[] {
  return Array.from(base64ToBytes(dataHrBase64));
}

/** Sleep stage mode codes — confirmed empirically against a live account
 *  (durations summed exactly to slp.lt/dp/wk and to ed-st). Reference
 *  sources only documented 4 and 5; 7 and 8 were derived here. */
export type SleepStageMode = 4 | 5 | 7 | 8;
export const SLEEP_STAGE_LABELS: Readonly<Record<SleepStageMode, string>> = {
  4: 'Light',
  5: 'Deep',
  7: 'Awake',
  8: 'REM',
};

export interface SleepStageSegment {
  /**
   * Minute-offset from local midnight of the day BEFORE this record's
   * `date_time` (which is the wake date) — NOT `date_time`'s own midnight,
   * and NOT epoch seconds. Verified live: record date_time=2026-07-07 with
   * offset 1656 anchors to midnight of 07-06, matching slp.st exactly at
   * that record's tz. Getting this anchor wrong silently shifts every
   * segment by 24h. `stop` is INCLUSIVE (segment duration = stop-start+1;
   * confirmed live durations sum exactly to slp.lt/dp/wk and to ed-st).
   * Converting to epoch seconds is a /db ingestion concern, not this file's.
   */
  readonly start: number;
  readonly stop: number;
  readonly mode: SleepStageMode;
}

export interface SleepSummary {
  readonly pe: number;
  /** Wake minutes — equals summed duration of mode-7 segments. */
  readonly wk: number;
  readonly wc: number;
  /** Sleep end, epoch seconds. */
  readonly ed: number;
  readonly ebt: number;
  readonly supNap: boolean;
  /** Deep sleep minutes — equals summed duration of mode-5 segments. */
  readonly dp: number;
  readonly lb: number;
  readonly odd_stage: readonly SleepStageSegment[];
  readonly is: number;
  readonly stage: readonly SleepStageSegment[];
  readonly napSleepSource: number;
  readonly isMerged: number;
  readonly napAlgoVersion: string;
  readonly supRem: boolean;
  /** Light sleep minutes — equals summed duration of mode-4 segments. */
  readonly lt: number;
  /** Resting HR (bpm) for this sleep session, device-computed. */
  readonly rhr: number;
  readonly sleepScoreVersion: string;
  readonly selected: number;
  readonly ps: number;
  /** NOTE: equals summed duration of mode-8 (REM) segments in the sample
   *  observed — name is misleading (reads like "deep time") but the number
   *  lines up with REM, not a second deep-sleep figure. Re-verify per account. */
  readonly dt: number;
  readonly ss: number;
  readonly sleepAlgoVersion: string;
  /** Sleep start, epoch seconds. (ed - st) == sum of all stage-mode durations. */
  readonly st: number;
  readonly sleepSource: number;
}

/** Activity mode codes for step/cadence segments (per checkpoint-0 research;
 *  not independently re-derived live the way sleep modes were). */
export type StepActivityMode = 1 | 3 | 4 | 7;
export const STEP_ACTIVITY_LABELS: Readonly<Record<StepActivityMode, string>> = {
  1: 'slow walking',
  3: 'fast walking',
  4: 'running',
  7: 'light activity',
};

export interface StepStageSegment {
  readonly start: number;
  readonly stop: number;
  readonly mode: StepActivityMode;
  readonly dis: number;
  readonly step: number;
  readonly cal: number;
}

export interface StepSummary {
  readonly runCal: number;
  readonly cal: number;
  readonly conAct: number;
  readonly ncal: number;
  readonly ttl: number;
  readonly dis: number;
  readonly rn: number;
  readonly wk: number;
  readonly stage: readonly StepStageSegment[];
  readonly runDist: number;
}

export interface DecodedBandSummary {
  readonly goal: number;
  readonly algv: string;
  readonly isMerged: number;
  readonly stp: StepSummary;
  /** Timezone offset in seconds, as a signed decimal string (e.g. "-25200"). */
  readonly tz: string;
  readonly v: number;
  readonly sn: string;
  readonly iOS: string;
  readonly slp: SleepSummary;
  readonly hr: { readonly maxHr: { readonly hr: number; readonly ts: number } };
  readonly byteLength: number;
  readonly sync: number;
}

export function isDecodedBandSummary(value: unknown): value is DecodedBandSummary {
  return (
    isRecord(value) &&
    typeof value['goal'] === 'number' &&
    isRecord(value['stp']) &&
    isRecord(value['slp'])
  );
}

/** Throws if the decoded payload doesn't match the confirmed live shape. */
export function decodeBandSummary(summaryBase64: string): DecodedBandSummary {
  const text = utf8BytesToString(base64ToBytes(summaryBase64));
  const parsed: unknown = JSON.parse(text);
  if (!isDecodedBandSummary(parsed)) {
    throw new Error('band_data summary payload did not match the confirmed DecodedBandSummary shape');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// GET /v1/sport/run/history.json — UNVERIFIED field list
// ---------------------------------------------------------------------------
// This account had zero workouts at discovery time, so these fields are
// sourced from rolandsz/Mi-Fit-and-Zepp-workout-exporter's documented schema,
// NOT from a live sample. Treat as provisional until a real workout is
// recorded and this endpoint is re-probed; do not add further fields on
// assumption alone.

export interface SportRunHistoryData {
  /** Pagination cursor for the next page; -1 (observed live) means no more pages. */
  readonly next: number;
  readonly summary: readonly WorkoutSummaryUnverified[];
}

export type SportRunHistoryResponse = ZeppEnvelope<SportRunHistoryData>;

/** UNVERIFIED — see module comment above. */
export interface WorkoutSummaryUnverified {
  readonly trackid: string;
  readonly source: string;
  readonly type?: number;
  readonly dis?: number;
  readonly calorie?: number;
  readonly avg_heart_rate?: number;
  readonly max_heart_rate?: number;
  readonly min_heart_rate?: number;
  readonly avg_pace?: number;
  readonly avg_cadence?: number;
  readonly max_cadence?: number;
  readonly spo2_max?: number;
  readonly spo2_min?: number;
  readonly avg_altitude?: number;
  readonly swolf?: number;
}

// ---------------------------------------------------------------------------
// GET /users/{userid}/events — CONFIRMED live (stress, SpO2, PAI)
// ---------------------------------------------------------------------------

export interface EventsResponse<T> {
  readonly items: readonly T[];
  /** A cursor object of the same shape as one item, for pagination. */
  readonly next?: T;
}

/** All numeric-looking fields are wire-typed as strings — confirmed live. */
export interface StressEvent {
  readonly userId: string;
  readonly eventType: string;
  readonly subType: string;
  readonly timestamp: number;
  readonly deviceType: string;
  readonly minStress: string;
  readonly maxStress: string;
  readonly avgStress: string;
  readonly mediumProportion: string;
  readonly relaxProportion: string;
  readonly highProportion: string;
  readonly normalProportion: string;
  readonly deviceSn: string;
  readonly deviceId: string;
  readonly deviceSource: string;
  readonly deviceMac: string;
  /** JSON-encoded string (NOT base64) of [{time, value}]; ~5min cadence observed. */
  readonly data: string;
}

export interface StressDataPoint {
  readonly time: number;
  readonly value: number;
}

export function decodeStressData(dataJson: string): readonly StressDataPoint[] {
  const parsed: unknown = JSON.parse(dataJson);
  if (!Array.isArray(parsed)) throw new Error('stress data field was not an array');
  return parsed.map((entry) => {
    if (!isRecord(entry) || typeof entry['time'] !== 'number' || typeof entry['value'] !== 'number') {
      throw new Error('stress data point did not match {time, value}');
    }
    return { time: entry['time'], value: entry['value'] };
  });
}

export interface Spo2Event {
  readonly userId: string;
  readonly eventType: string;
  readonly subType: string;
  readonly timestamp: number;
  readonly timezone: string;
  /** JSON-encoded string; see decodeSpo2Extra(). */
  readonly extra: string;
}

export interface Spo2ExtraDecoded {
  /** Up to 60 samples; trailing zeros observed live look like padding, not signal — verify before use. */
  readonly spo2History: readonly number[];
  readonly deviceSource: number;
  readonly sn: string;
  readonly timestamp: number;
  readonly timezone: string;
  readonly deviceId: string;
  readonly spo2: number;
  readonly subType: string;
  readonly isAuto: boolean;
}

export function decodeSpo2Extra(extraJson: string): Spo2ExtraDecoded {
  const parsed: unknown = JSON.parse(extraJson);
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed['spo2History']) ||
    typeof parsed['spo2'] !== 'number'
  ) {
    throw new Error('spo2 extra payload did not match the confirmed shape');
  }
  return parsed as unknown as Spo2ExtraDecoded;
}

/** All numeric-looking fields are wire-typed as strings — confirmed live. */
export interface PaiEvent {
  readonly userId: string;
  readonly eventType: string;
  readonly subType: string;
  readonly timestamp: number;
  /** JSON-encoded array of 7 numbers as a string, e.g. "[0,0,0,0,0,0,0]". */
  readonly activityScores: string;
  readonly nextActivityScores: string;
  readonly mediumZoneLowerLimit: string;
  readonly mediumZonePai: string;
  readonly mediumZoneMinutes: string;
  readonly lowZoneLowerLimit: string;
  readonly lowZonePai: string;
  readonly lowZoneMinutes: string;
  readonly highZoneLowerLimit: string;
  readonly highZonePai: string;
  readonly highZoneMinutes: string;
  readonly totalPai: string;
  readonly dailyPai: string;
  /** Device-computed max HR — cross-check candidate for Model A's HR_max. */
  readonly maxHr: string;
  /** Device-computed resting HR — cross-check candidate for Model A's HR_rest. */
  readonly restHr: string;
  readonly age: string;
  readonly gender: string;
  readonly index: string;
  readonly version: string;
  readonly timeZone: string;
  readonly deviceId: string;
  readonly deviceSource: string;
  readonly sn: string;
  readonly time: string;
  readonly uploadTimestamp: string;
}

// ---------------------------------------------------------------------------
// GET /users/{userid} — CONFIRMED live; resolves the Phase 0 age-sourcing gap
// ---------------------------------------------------------------------------

export interface UserProfile {
  readonly userId: string;
  readonly nickName: string;
  readonly applicationName: string;
  readonly applicationPlatform: string;
  /** "YYYY-MM" — no day-of-month. Sufficient for the Age input to Model A. */
  readonly birthday: string;
  readonly createTime: number;
  readonly gender: number;
  /** cm */
  readonly height: number;
  readonly idSource: string;
  readonly lastUpdateTime: number;
  /** kg */
  readonly weight: number;
  readonly preferredLanguage: string;
  readonly userOldProfile: { readonly nickName: string };
  readonly defaultFields: readonly unknown[];
}

/** Age in whole years from the profile's "YYYY-MM" birthday, as of `now`. */
export function ageFromBirthday(birthday: string, now: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})$/.exec(birthday);
  if (match === null) throw new Error(`unexpected birthday format: ${birthday}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Shared guard
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Dependency-free base64 / UTF-8 decoding (no Buffer, no atob/TextDecoder)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Standard (padded) base64 -> bytes. Whitespace is stripped defensively. */
function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n\s]/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error(`base64ToBytes: input length ${clean.length} is not a multiple of 4`);
  }
  let padCount = 0;
  if (clean.endsWith('==')) padCount = 2;
  else if (clean.endsWith('=')) padCount = 1;

  const outLength = (clean.length / 4) * 3 - padCount;
  const out = new Uint8Array(outLength);
  let outIndex = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_LOOKUP[clean.charCodeAt(i)] as number;
    const c1 = BASE64_LOOKUP[clean.charCodeAt(i + 1)] as number;
    const isPad2 = clean[i + 2] === '=';
    const isPad3 = clean[i + 3] === '=';
    const c2 = isPad2 ? 0 : (BASE64_LOOKUP[clean.charCodeAt(i + 2)] as number);
    const c3 = isPad3 ? 0 : (BASE64_LOOKUP[clean.charCodeAt(i + 3)] as number);
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (outIndex < outLength) out[outIndex++] = (triple >> 16) & 0xff;
    if (outIndex < outLength) out[outIndex++] = (triple >> 8) & 0xff;
    if (outIndex < outLength) out[outIndex++] = triple & 0xff;
  }
  return out;
}

/** Minimal UTF-8 decoder (bytes -> string), hand-rolled to avoid a TextDecoder dependency. */
function utf8BytesToString(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i] as number;
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const byte2 = bytes[i + 1] as number;
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const byte2 = bytes[i + 1] as number;
      const byte3 = bytes[i + 2] as number;
      result += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      i += 3;
    } else if ((byte1 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const byte2 = bytes[i + 1] as number;
      const byte3 = bytes[i + 2] as number;
      const byte4 = bytes[i + 3] as number;
      const codepoint =
        (((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f)) - 0x10000;
      result += String.fromCharCode(0xd800 + (codepoint >> 10), 0xdc00 + (codepoint & 0x3ff));
      i += 4;
    } else {
      i += 1; // invalid leading byte; skip rather than throw on malformed input
    }
  }
  return result;
}
