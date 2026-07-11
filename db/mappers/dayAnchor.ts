/**
 * dayAnchor.ts — shared "minute-offset from local midnight" anchoring used
 * by sleep stage segments and step/activity segments in band_data summaries.
 * See sleepStageMapper.ts for the live-verified evidence that THAT anchor is
 * midnight of the day BEFORE the record's own `date_time`.
 *
 * THE `hr_days.hr_minutes` BLOB DOES NOT USE THE SAME ANCHOR — see
 * `hrBlobAnchorUtc` below. Do not assume the two band_data.json record types
 * (detail vs summary) share one convention; they were live-verified
 * separately and turned out to differ. Flagged during the post-Phase-2
 * Fable integration checkpoint as exactly the kind of assumption Phase 3's
 * /hooks mapper could get wrong by pattern-matching on the (better
 * documented) segment convention.
 */

export class DayAnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DayAnchorError';
  }
}

/** Epoch seconds of local midnight on `dateTime`, given that record's own tz offset. */
export function localMidnightUtc(dateTime: string, tzOffsetSec: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateTime);
  if (match === null) throw new DayAnchorError(`invalid date_time: ${dateTime}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Treat Y-M-D as if it were a UTC calendar date, then correct for the
  // record's own tz offset (local = UTC + offset, so UTC = local - offset).
  const asIfUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  return Math.floor(asIfUtcMs / 1000) - tzOffsetSec;
}

/** The anchor sleep/step minute-offsets are actually relative to — one day before `dateTime`'s own midnight. */
export function segmentAnchorUtc(dateTime: string, tzOffsetSec: number): number {
  return localMidnightUtc(dateTime, tzOffsetSec) - 86400;
}

/**
 * The anchor `hr_days.hr_minutes`'s byte index (0-1439) is relative to —
 * `dateTime`'s OWN midnight, NOT the day before (contrast segmentAnchorUtc).
 *
 * Verified empirically (no max_hr_at_utc ground truth was available in this
 * account's data to cross-check directly, so this used the live
 * sleep_sessions window instead): for date_time=2026-07-08, sleep_sessions
 * gives a real (start_utc, end_utc) of (1783503000, 1783526760). Anchoring
 * to date_time's own midnight maps that window to blob minute-indices
 * [150, 546) — in-range and, checked against the actual bytes, averaging
 * 63.6 bpm (resting) vs. 88.1 bpm for the same day's indices [600, 1000)
 * (waking hours). Anchoring to date_time-minus-one-day (the segment
 * convention) maps the same window to [1590, 1986) — entirely outside the
 * valid [0, 1440) range for a single day's blob, i.e. not even a candidate.
 */
export function hrBlobAnchorUtc(dateTime: string, tzOffsetSec: number): number {
  return localMidnightUtc(dateTime, tzOffsetSec);
}
