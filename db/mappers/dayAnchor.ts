/**
 * dayAnchor.ts — shared "minute-offset from local midnight" anchoring used
 * by both sleep stage segments and step/activity segments in band_data
 * summaries. See sleepStageMapper.ts for the live-verified evidence that the
 * anchor is midnight of the day BEFORE the record's own `date_time`.
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

/** The anchor minute-offsets are actually relative to — one day before `dateTime`'s own midnight. */
export function segmentAnchorUtc(dateTime: string, tzOffsetSec: number): number {
  return localMidnightUtc(dateTime, tzOffsetSec) - 86400;
}
