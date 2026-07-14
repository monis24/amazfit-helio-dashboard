/**
 * stressBands.ts — the Zepp app's own stress-score bands (confirmed from
 * its in-app explanation screen: "0-39 relaxed; 40-59 normal; 60-79 medium;
 * 80-100 high"), not an invented threshold set. Used to color-code the
 * Continuous Vitals stress chart the same way the source app does.
 */

import { colors } from './theme';

export interface StressBandDef {
  readonly band: 'relaxed' | 'normal' | 'medium' | 'high';
  readonly min: number;
  readonly max: number;
  readonly color: string;
  readonly label: string;
}

export const STRESS_BANDS: readonly StressBandDef[] = [
  { band: 'relaxed', min: 0, max: 39, color: colors.stressRelaxed, label: 'Relaxed' },
  { band: 'normal', min: 40, max: 59, color: colors.stressNormal, label: 'Normal' },
  { band: 'medium', min: 60, max: 79, color: colors.stressMedium, label: 'Medium' },
  { band: 'high', min: 80, max: 100, color: colors.stressHigh, label: 'High' },
];

export function stressBandFor(value: number): StressBandDef {
  // The Zepp bands are defined on the integer score scale (0-39, 40-59, ...),
  // but StressChart passes bucketed AVERAGES, which are fractional — a raw
  // 39.5 sits between relaxed's max (39) and normal's min (40), missed every
  // band, and fell through to the 'high' fallback (worst-possible color for
  // a relaxed-ish reading). Round back onto the integer scale the bands are
  // defined on before matching; the fallback now only catches out-of-scale
  // values (> 100), for which 'high' is the honest clamp.
  const rounded = Math.round(value);
  return (
    STRESS_BANDS.find((b) => rounded >= b.min && rounded <= b.max) ??
    (STRESS_BANDS[STRESS_BANDS.length - 1] as StressBandDef)
  );
}
