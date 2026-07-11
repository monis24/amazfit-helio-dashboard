/**
 * sleepStageMapper.ts — converts a decoded band_data summary's sleep stage
 * segments (minute-offsets from local midnight) into absolute epoch seconds.
 *
 * THE ANCHORING BUG THIS GUARDS AGAINST: segment offsets are minutes from
 * local midnight of the day BEFORE the record's own `date_time` (which is
 * the wake date) — NOT `date_time`'s own midnight. Building this the obvious
 * way (anchor to date_time's midnight) silently shifts every hypnogram by
 * 24 hours. Verified against all three live Phase 0 samples: the formula
 * below reproduces slp.st/slp.ed exactly. See types/ZeppApiSchemas.ts's
 * SleepStageSegment comment for the live evidence.
 *
 * The assertion below is deliberate, not defensive boilerplate: it's also
 * the DST canary (tz is per-record) and the guard against a firmware/account
 * variant that anchors differently — reject and log rather than silently
 * store wrong times.
 */

import type { DecodedBandSummary, SleepStageMode } from '../../types/ZeppApiSchemas';
import { segmentAnchorUtc } from './dayAnchor';

export interface AnchoredSleepStageSegment {
  readonly startUtc: number;
  /** Exclusive — wire `stop` is inclusive; endUtc = anchor + (stop+1)*60. */
  readonly endUtc: number;
  readonly stage: SleepStageMode;
}

export interface AnchoredSleepSession {
  readonly startUtc: number;
  readonly endUtc: number;
  readonly lightMin: number;
  readonly deepMin: number;
  /** Sourced from slp.dt — confirmed live to sum to the REM segments despite the misleading name. */
  readonly remMin: number;
  readonly awakeMin: number;
  readonly restingHr: number | undefined;
  readonly segments: readonly AnchoredSleepStageSegment[];
}

export class SleepAnchoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SleepAnchoringError';
  }
}

/**
 * Maps a band_data_summary record's sleep segments to epoch seconds.
 * Throws SleepAnchoringError if the anchored segments don't reconstruct
 * slp.st/slp.ed exactly — callers should catch, log, and skip persisting
 * that day's sleep data rather than store silently-wrong times.
 */
export function mapSleepSummaryToSession(dateTime: string, decoded: DecodedBandSummary): AnchoredSleepSession {
  const tzOffsetSec = Number(decoded.tz);
  if (!Number.isFinite(tzOffsetSec)) {
    throw new SleepAnchoringError(`invalid tz offset "${decoded.tz}" for ${dateTime}`);
  }
  if (decoded.slp.stage.length === 0) {
    throw new SleepAnchoringError(`no sleep stage segments for ${dateTime}`);
  }

  const anchor = segmentAnchorUtc(dateTime, tzOffsetSec);

  const segments = decoded.slp.stage
    .map((seg) => ({
      startUtc: anchor + seg.start * 60,
      endUtc: anchor + (seg.stop + 1) * 60,
      stage: seg.mode,
    }))
    .sort((a, b) => a.startUtc - b.startUtc);

  const first = segments[0] as AnchoredSleepStageSegment;
  const last = segments[segments.length - 1] as AnchoredSleepStageSegment;

  if (first.startUtc !== decoded.slp.st) {
    throw new SleepAnchoringError(
      `anchoring mismatch for ${dateTime}: first segment startUtc=${first.startUtc} != slp.st=${decoded.slp.st}`,
    );
  }
  if (last.endUtc !== decoded.slp.ed) {
    throw new SleepAnchoringError(
      `anchoring mismatch for ${dateTime}: last segment endUtc=${last.endUtc} != slp.ed=${decoded.slp.ed}`,
    );
  }

  return {
    startUtc: decoded.slp.st,
    endUtc: decoded.slp.ed,
    lightMin: decoded.slp.lt,
    deepMin: decoded.slp.dp,
    remMin: decoded.slp.dt,
    awakeMin: decoded.slp.wk,
    restingHr: decoded.slp.rhr,
    segments,
  };
}
