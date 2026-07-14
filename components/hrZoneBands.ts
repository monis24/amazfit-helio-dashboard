/**
 * hrZoneBands.ts — HR zone names/colors matching the Zepp app's own
 * "Heart Rate Zone" workout breakdown (Light/Intensive/Aerobic/Anaerobic/
 * VO2 Max). Zepp's screen shows fixed bpm numbers, but those are that
 * particular workout's zones at that account's own max HR — not a
 * universal bpm table. The %HRmax breakpoints here are the same 50/60/70/
 * 80/90 bands CadenceEngine.ts's ZONES already uses (a standard 5-zone
 * %HRmax model), just relabeled to Zepp's names and given a color each, so
 * a given %HRmax always lands in the same named zone regardless of the
 * viewer's own HR_max.
 *
 * Zepp's own screen was a WORKOUT summary — every sample there is already
 * elevated, so it never needed a zone below 50% HR_max. This chart instead
 * covers a full 24 hours, and most of a day (sleep, sitting) sits well
 * under 50% HR_max — CadenceEngine's original "below Light isn't a zone"
 * treatment left nearly the whole day uncolored and undrawn. Added a
 * Resting band for that range so the chart still shows the data.
 */

import { colors } from './theme';

export interface HrZoneBandDef {
  readonly zone: string;
  readonly minFraction: number;
  readonly maxFraction: number;
  readonly color: string;
}

export const HR_ZONE_BANDS: readonly HrZoneBandDef[] = [
  { zone: 'Resting', minFraction: 0, maxFraction: 0.5, color: colors.hrResting },
  { zone: 'Light', minFraction: 0.5, maxFraction: 0.6, color: colors.hrLight },
  { zone: 'Intensive', minFraction: 0.6, maxFraction: 0.7, color: colors.hrIntensive },
  { zone: 'Aerobic', minFraction: 0.7, maxFraction: 0.8, color: colors.hrAerobic },
  { zone: 'Anaerobic', minFraction: 0.8, maxFraction: 0.9, color: colors.hrAnaerobic },
  { zone: 'VO2 Max', minFraction: 0.9, maxFraction: Infinity, color: colors.hrVo2Max },
];

export function hrZoneBandFor(bpm: number, hrMax: number): HrZoneBandDef | undefined {
  const fraction = bpm / hrMax;
  return HR_ZONE_BANDS.find((b) => fraction >= b.minFraction && fraction < b.maxFraction);
}
