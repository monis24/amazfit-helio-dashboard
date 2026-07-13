/**
 * hrBlobMapper.ts — maps an hr_days row's 1440-byte-per-day blob into the
 * dense HrSample[] BiometricEngine.ts/CadenceEngine.ts consume. Uses
 * hrBlobAnchorUtc (dayAnchor.ts), NOT segmentAnchorUtc — see that file's doc
 * comment for the live-verified evidence these two anchors differ.
 *
 * Validity check is "plausible resting/exercise bpm range," not merely "not
 * exactly the 254 sentinel" — db/schema.ts's hr_days comment: only 254 was
 * observed as junk in this account's data, but a future account/firmware
 * could differ, so a range check is the real guard.
 */

import type { HrSample } from '../../engines/BiometricEngine';
import { hrBlobAnchorUtc } from './dayAnchor';

const MIN_PLAUSIBLE_BPM = 30;
const MAX_PLAUSIBLE_BPM = 220;

export interface HrDayForMapping {
  readonly localDate: string;
  readonly tzOffsetSec: number;
  readonly hrMinutes: Uint8Array | readonly number[];
}

/** Adapts a raw hr_days row (db/queries/bandData.ts's HrDayRow, snake_case
 *  to match the SQL column names) to this file's camelCase input shape. */
export function hrDayRowToMapping(row: {
  readonly local_date: string;
  readonly tz_offset_sec: number;
  readonly hr_minutes: Uint8Array;
}): HrDayForMapping {
  return { localDate: row.local_date, tzOffsetSec: row.tz_offset_sec, hrMinutes: row.hr_minutes };
}

function isPlausibleBpm(bpm: number): boolean {
  return bpm >= MIN_PLAUSIBLE_BPM && bpm <= MAX_PLAUSIBLE_BPM;
}

/** One day's worth of minute-cadence samples, sentinel/junk minutes dropped
 *  (absent from the array, not zero — matches HrSample's own contract). */
export function mapHrDayToSamples(row: HrDayForMapping): readonly HrSample[] {
  const anchor = hrBlobAnchorUtc(row.localDate, row.tzOffsetSec);
  const samples: HrSample[] = [];
  for (let minute = 0; minute < row.hrMinutes.length; minute++) {
    const bpm = row.hrMinutes[minute] as number;
    if (!isPlausibleBpm(bpm)) continue;
    samples.push({ t: anchor + minute * 60, bpm });
  }
  return samples;
}

/** Splices multiple days' blobs into one chronologically-sorted sample
 *  array, then filters to [fromUtc, toUtc) — the shape /hooks needs for a
 *  UTC time window that crosses a day boundary. */
export function mapHrDaysToSamplesInRange(
  rows: readonly HrDayForMapping[],
  fromUtc: number,
  toUtc: number,
): readonly HrSample[] {
  return rows
    .flatMap(mapHrDayToSamples)
    .filter((s) => s.t >= fromUtc && s.t < toUtc)
    .sort((a, b) => a.t - b.t);
}
