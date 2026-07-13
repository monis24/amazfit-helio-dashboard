/**
 * StressTrendEngine.ts — sketched during the post-Phase-0 replanning pass,
 * deliberately scoped out of Phase 2's BiometricEngine.ts (CLAUDE.md limits
 * Phase 2 to VO2 Max + HRR/EPOC). Feeds the Insights Card's stress trend.
 *
 * Device-computed passthrough, per SPEC.md Phase 2's stress section: no
 * cloud endpoint exposes raw IBI/RR arrays, so Huami's own proprietary daily
 * stress score (stress_days table) is the only input — this is trend
 * AGGREGATION over already-device-computed values, not a locally-derived
 * formula. Label the result "device-computed" wherever it's displayed.
 *
 * Same purity contract as BiometricEngine.ts: no /db access, no Date.now().
 */

export type EpochSeconds = number;

export type EngineResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'insufficient-data'; readonly reason: string };

/** One day's stress_days row, mapped to a pure domain shape by /hooks. */
export interface StressDaySummary {
  readonly localDate: string;
  /** Null on a day with no stress data recorded — routine, not an error. */
  readonly avgStress: number | null;
}

export interface StressTrendResult {
  readonly direction: 'up' | 'down' | 'flat';
  readonly deltaAvg: number;
}

export interface StressTrendInput {
  /** Trend window, in any order — sorted internally by localDate. SPEC.md's
   *  Insights Card calls for a 7-day trend, but this doesn't hardcode 7 so
   *  a shorter real window (e.g. day 3 of device ownership) still degrades
   *  gracefully rather than needing a magic-number guard at the call site. */
  readonly days: readonly StressDaySummary[];
  /**
   * |deltaAvg| below this counts as 'flat' rather than 'up'/'down' — daily
   * stress scores are noisy device output, so a 1-point wobble shouldn't
   * read as a trend. Same scale as the 0-100-ish stress score.
   */
  readonly flatThreshold?: number;
}

/**
 * Compares the mean of the first half of the window against the second half
 * (not a full linear regression) — SPEC.md's Phase 2 section calls this
 * "device-computed... [BiometricEngine] passes this through unmodified,"
 * i.e. the aggregation itself should stay simple, legible arithmetic, not
 * import statistical machinery for a vendor score that's already smoothed
 * upstream. Odd-length windows put the middle day in neither half.
 */
export function stressSevenDayTrend(input: StressTrendInput): EngineResult<StressTrendResult> {
  const flatThreshold = input.flatThreshold ?? 2;

  const withData = input.days
    .filter((d): d is StressDaySummary & { avgStress: number } => d.avgStress !== null)
    .slice()
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  if (withData.length < 2) {
    return { kind: 'insufficient-data', reason: 'fewer than 2 days with a recorded stress average' };
  }

  const halfSize = Math.floor(withData.length / 2);
  const earlyHalf = withData.slice(0, halfSize);
  const lateHalf = withData.slice(withData.length - halfSize);

  const earlyAvg = mean(earlyHalf.map((d) => d.avgStress));
  const lateAvg = mean(lateHalf.map((d) => d.avgStress));
  const deltaAvg = lateAvg - earlyAvg;

  const direction: StressTrendResult['direction'] =
    Math.abs(deltaAvg) < flatThreshold ? 'flat' : deltaAvg > 0 ? 'up' : 'down';

  return { kind: 'ok', value: { direction, deltaAvg } };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
