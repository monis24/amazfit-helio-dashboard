/**
 * BiometricEngine.ts — Phase 2 pure biometric computations (SPEC.md Phase 2:
 * VO2 Max Model A/B, HRR/EPOC).
 *
 * PURITY CONTRACT: every function here is pure — typed inputs/outputs, no
 * /db access, no Date.now(), no I/O. This is the resolution the post-Phase-0
 * replanning checkpoint settled on for SPEC.md's original (pre-checkpoint)
 * "utility class reading from the local database" framing, which
 * contradicted CLAUDE.md's "/engines functions are pure" rule. A thin
 * orchestration layer in /hooks (Phase 3) reads /db, maps rows to the
 * domain sample types below, and calls these functions — this file never
 * knows /db, base64, or wire formats exist.
 *
 * Fallible computations return EngineResult rather than throwing: on this
 * live account, "insufficient data" is the COMMON case (zero recorded
 * workouts at Phase 0 discovery time — see FIELD_INVENTORY.md), not an edge
 * case, so screens must render it as a first-class state. Throwing is
 * reserved for genuine caller/programmer errors (e.g. a non-positive age).
 *
 * Scope note: stress-trend aggregation, the sleep-restlessness proxy, and
 * cadence-by-HR-zone bucketing were sketched during the post-Phase-0
 * replanning pass but are deliberately NOT implemented here — they belong
 * with the Phase 3 panels that consume them (Vitals Panel, Sleep Hypnogram,
 * Cadence & Efficiency), per CLAUDE.md's Phase 2 scope of "VO2 Max (Model
 * A+B), HRR/EPOC."
 */

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export type EpochSeconds = number;

/** Minute-cadence (or coarser) HR sample. Missing minutes are ABSENT from the
 *  array, not zero — the wire's 254 "no reading" sentinel is stripped before
 *  this type is ever populated (a /db-mapper concern, not this file's). */
export interface HrSample {
  readonly t: EpochSeconds;
  readonly bpm: number;
}

export type EngineResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'insufficient-data'; readonly reason: string };

// ---------------------------------------------------------------------------
// VO2 Max — Model A (Resting Baseline)
// ---------------------------------------------------------------------------

export interface RestingHrInput {
  /** HR samples spanning at least the search window before sleepEnd. May span two calendar days — splicing that is a /hooks concern. */
  readonly samples: readonly HrSample[];
  /** Wake time (slp.ed) — the search window is the final `searchWindowMinutes` before this. */
  readonly sleepEnd: EpochSeconds;
  /** SPEC.md: "final 120 minutes of sleep." */
  readonly searchWindowMinutes?: number;
  /** SPEC.md: "lowest 5-minute rolling average." */
  readonly rollingWindowMinutes?: number;
  /**
   * Fraction of a full rolling window's samples that must be present for
   * that window to be considered (e.g. 0.6 of a 5-sample window needs >= 3
   * real readings). Guards against a single lonely sample masquerading as a
   * genuine 5-minute average — HR data has real gaps (the "no reading"
   * sentinel), so this can't assume perfect density.
   */
  readonly minCoverageRatio?: number;
}

export interface RestingHrResult {
  readonly hrRest: number;
  readonly windowStart: EpochSeconds;
}

/**
 * Finds the lowest 5-minute rolling-average HR within the final 120 minutes
 * before wake time. Candidate window starts are the samples' own timestamps
 * (not a fixed grid) — real minima align with actual readings, and this
 * avoids assuming a specific sampling cadence.
 *
 * BIAS NOTE (Phase 2 Fable checkpoint): the minCoverageRatio threshold biases
 * HR_rest DOWNWARD, not neutrally — because this function takes the MINIMUM
 * across windows, a sparse under-covered window that happens to catch a
 * transient low cluster gets counted as a valid "5-minute average" just as
 * readily as a fully-covered one, and a lower HR_rest inflates VO2max
 * (15.3 * HR_max/HR_rest). At true minute-cadence data a clean window has
 * all 5 samples regardless, so this only bites under real sentinel-driven
 * gaps. If overnight data turns out consistently dense, raising the default
 * (e.g. to 0.8) would tighten this — a data-driven tuning, not a fix.
 */
export function computeRestingHr(input: RestingHrInput): EngineResult<RestingHrResult> {
  const searchWindowMinutes = input.searchWindowMinutes ?? 120;
  const rollingWindowMinutes = input.rollingWindowMinutes ?? 5;
  const minCoverageRatio = input.minCoverageRatio ?? 0.6;

  const searchStart = input.sleepEnd - searchWindowMinutes * 60;
  const rollingWindowSeconds = rollingWindowMinutes * 60;
  const minSamplesNeeded = Math.ceil(rollingWindowMinutes * minCoverageRatio);

  const inSearchWindow = input.samples
    .filter((s) => s.t >= searchStart && s.t <= input.sleepEnd)
    .sort((a, b) => a.t - b.t);

  if (inSearchWindow.length === 0) {
    return { kind: 'insufficient-data', reason: 'no HR samples in the final search window before sleep end' };
  }

  let best: { avg: number; windowStart: number } | undefined;

  for (const candidate of inSearchWindow) {
    const windowStart = candidate.t;
    const windowEnd = windowStart + rollingWindowSeconds;
    const windowSamples = inSearchWindow.filter((s) => s.t >= windowStart && s.t < windowEnd);
    if (windowSamples.length < minSamplesNeeded) continue;

    const avg = mean(windowSamples.map((s) => s.bpm));
    if (best === undefined || avg < best.avg) {
      best = { avg, windowStart };
    }
  }

  if (best === undefined) {
    return {
      kind: 'insufficient-data',
      reason: `no ${rollingWindowMinutes}-minute window met the ${minSamplesNeeded}-sample coverage threshold`,
    };
  }

  return { kind: 'ok', value: { hrRest: best.avg, windowStart: best.windowStart } };
}

/** Gellish (2007) age-predicted max HR: HR_max = 207 - 0.7 * Age. */
export function gellishHrMax(ageYears: number): number {
  if (!Number.isFinite(ageYears) || ageYears <= 0) {
    throw new Error(`gellishHrMax: invalid age ${ageYears}`);
  }
  return 207 - 0.7 * ageYears;
}

/** Uth-Sørensen-Pedersen (2004): VO2_max = 15.3 * (HR_max / HR_rest). */
export function vo2MaxModelA(hrMax: number, hrRest: number): number {
  if (!Number.isFinite(hrRest) || hrRest <= 0) {
    throw new Error(`vo2MaxModelA: invalid hrRest ${hrRest}`);
  }
  return 15.3 * (hrMax / hrRest);
}

// ---------------------------------------------------------------------------
// VO2 Max — Model B (Submaximal Linear Regression)
// ---------------------------------------------------------------------------

/** One workout-stream sample. Absent bpm/speed (not zero) — the Helio has no
 *  GPS, so speed is only present when a workout was tracked with phone GPS. */
export interface WorkoutStreamSample {
  readonly t: EpochSeconds;
  readonly bpm?: number;
  readonly speedMPerMin?: number;
}

export interface ModelBInput {
  readonly stream: readonly WorkoutStreamSample[];
  readonly hrMax: number;
  readonly hrRest: number;
  /** SPEC.md: "3-minute steady-state window." */
  readonly steadyStateSeconds?: number;
  /** SPEC.md: "deviate less than 3%." */
  readonly maxDeviationRatio?: number;
  /** SPEC.md: "HR sits between 65%-85% of HR_max." */
  readonly hrBand?: readonly [number, number];
  /** Minimum points required inside a candidate window for the deviation
   *  check to mean anything (two edge points would trivially "pass"). The
   *  workout stream's real sampling density is unverified (FIELD_INVENTORY.md
   *  — the account has zero recorded workouts), so this stays a conservative,
   *  overridable floor rather than an assumption about exact cadence. */
  readonly minSamplesInWindow?: number;
}

export interface ModelBResult {
  readonly vo2Max: number;
  readonly windowStart: EpochSeconds;
  readonly windowEnd: EpochSeconds;
  readonly hrExercise: number;
  readonly speedMPerMin: number;
}

/**
 * Finds a steady-state window in a workout stream and extrapolates VO2 max
 * from it. Returns a distinct `reason` for "no speed data at all" (the
 * expected outcome for indoor/non-GPS workouts, or — right now — any
 * workout, since the account has zero recorded ones) vs. "speed/HR data
 * exists but never stabilizes" — screens should be able to tell these apart.
 *
 * Window selection is "first chronologically qualifying window wins," not a
 * search for the single best (lowest-deviation/longest) candidate among
 * several that qualify. Confirmed by the Phase 2 Fable checkpoint as
 * defensible — VO2max is fairly insensitive to which in-band steady window
 * you pick, since the %HRR≈%VO2R ratio self-normalizes — but untested
 * against real data (this account has zero recorded workouts). Revisit if a
 * warm-up-then-settle workout picks a noisier early window over a cleaner
 * later one.
 */
export function vo2MaxModelB(input: ModelBInput): EngineResult<ModelBResult> {
  const steadyStateSeconds = input.steadyStateSeconds ?? 180;
  const maxDeviationRatio = input.maxDeviationRatio ?? 0.03;
  const [hrBandLow, hrBandHigh] = input.hrBand ?? [0.65, 0.85];
  const minSamplesInWindow = input.minSamplesInWindow ?? 3;

  const withBoth = input.stream
    .filter((s): s is WorkoutStreamSample & { bpm: number; speedMPerMin: number } => s.bpm !== undefined && s.speedMPerMin !== undefined)
    .sort((a, b) => a.t - b.t);

  if (withBoth.length === 0) {
    return {
      kind: 'insufficient-data',
      reason: 'no-speed-data: workout stream has no samples with both HR and speed present',
    };
  }

  for (const candidate of withBoth) {
    const windowStart = candidate.t;
    const windowEnd = windowStart + steadyStateSeconds;
    const windowSamples = withBoth.filter((s) => s.t >= windowStart && s.t < windowEnd);
    if (windowSamples.length < minSamplesInWindow) continue;

    const bpms = windowSamples.map((s) => s.bpm);
    const speeds = windowSamples.map((s) => s.speedMPerMin);
    const bpmMean = mean(bpms);
    const speedMean = mean(speeds);

    if (maxDeviationRatio_(bpms, bpmMean) > maxDeviationRatio) continue;
    if (maxDeviationRatio_(speeds, speedMean) > maxDeviationRatio) continue;

    const hrFraction = bpmMean / input.hrMax;
    if (hrFraction < hrBandLow || hrFraction > hrBandHigh) continue;

    // ACSM RUNNING metabolic equation (0.2*speed + 3.5), level grade -- not
    // the walking equation (which uses 0.1). Confirmed against ACSM's
    // Guidelines by the Phase 2 Fable checkpoint: 0.2 is the correct
    // coefficient for running speeds. Steady-state at 65-85% HR_max is
    // running intensity, so this is the right equation for this use, but
    // it's only validated for genuine running speeds (roughly >=134 m/min /
    // 5mph) -- applying it to walking-speed data would need 0.1, not 0.2.
    const vo2Cost = 0.2 * speedMean + 3.5;
    // %HRR ~= %VO2R (Swain et al. 1994 / ACSM) extrapolation, VO2_rest=3.5.
    const vo2Max =
      ((input.hrMax - input.hrRest) / (bpmMean - input.hrRest)) * (vo2Cost - 3.5) + 3.5;

    return {
      kind: 'ok',
      value: { vo2Max, windowStart, windowEnd, hrExercise: bpmMean, speedMPerMin: speedMean },
    };
  }

  return {
    kind: 'insufficient-data',
    reason: 'no-steady-state-window: HR/speed data exists but no window met the deviation and HR-band criteria',
  };
}

// ---------------------------------------------------------------------------
// EPOC & Recovery Windows (HRR1 / HRR2)
// ---------------------------------------------------------------------------

export interface HrrInput {
  /** HR samples after exercise ends. May be sparser than 1/minute. */
  readonly postExercise: readonly HrSample[];
  readonly exerciseEnd: EpochSeconds;
  readonly hrAtEnd: number;
  /**
   * Resting HR (Model A's output) — the physiological target "recovery time
   * remaining" counts down to. SPEC.md doesn't name a target explicitly;
   * resting HR is the only value in this project that means "recovered."
   * Confirmed sound by the Phase 2 Fable checkpoint, with one disclosed
   * bias: overnight resting HR is STRICTER than pre-exercise/standing HR
   * (the more common clinical convention), so estimates here will run
   * LONGER than a "return to pre-exercise HR" convention would give. Label
   * this as "time to resting HR" in the UI, not generic "recovered."
   */
  readonly hrRest: number;
  /** How close a sample must be to the 1-/2-minute marks to count (real streams aren't sampled exactly on the minute). */
  readonly sampleToleranceSeconds?: number;
}

export interface HrrResult {
  readonly hrr1: number;
  /** Undefined if no sample exists near the 2-minute mark (HRR1 alone is still a valid, common clinical metric). */
  readonly hrr2: number | undefined;
  readonly recoverySlopeBpmPerMin: number;
  /**
   * Undefined when the fitted slope isn't decreasing (HR flat/rising —
   * common with only 1-2 minutes of coarse data) or when there aren't
   * enough points to fit a meaningful line; a genuine "can't estimate yet"
   * rather than forcing a number out of noise. 0 when the last sample has
   * already reached hrRest.
   */
  readonly estimatedRecoveryMinutes: number | undefined;
}

/**
 * Computes HRR1/HRR2 (SPEC.md: "Heart Rate Recovery at 1-minute and 2-minute
 * intervals") and a linear-regression recovery slope extrapolated forward to
 * hrRest for an estimated recovery time remaining ("model sympathetic
 * down-regulation slope... to estimate recovery time remaining").
 *
 * LINEAR, NOT BI-EXPONENTIAL (confirmed acceptable by the Phase 2 Fable
 * checkpoint, given SPEC.md literally says "slope"): real HRR decay is
 * bi-exponential — a steep early parasympathetic-rebound phase that
 * flattens out. Fitting a straight line through the first 1-2 minutes
 * captures that steep early portion, so extrapolating it out to hrRest
 * UNDERESTIMATES recovery time (predicts a faster return than reality).
 * This improves as more post-exercise data accrues; treat early-workout
 * estimates as optimistic, not precise.
 */
export function computeHrr(input: HrrInput): EngineResult<HrrResult> {
  const sampleToleranceSeconds = input.sampleToleranceSeconds ?? 30;

  const sorted = [...input.postExercise].sort((a, b) => a.t - b.t);

  const hr1Sample = findClosestSample(sorted, input.exerciseEnd + 60, sampleToleranceSeconds);
  if (hr1Sample === undefined) {
    return { kind: 'insufficient-data', reason: 'no HR sample near the 1-minute post-exercise mark' };
  }
  const hrr1 = input.hrAtEnd - hr1Sample.bpm;

  const hr2Sample = findClosestSample(sorted, input.exerciseEnd + 120, sampleToleranceSeconds);
  const hrr2 = hr2Sample !== undefined ? input.hrAtEnd - hr2Sample.bpm : undefined;

  const regressionPoints: readonly { t: EpochSeconds; bpm: number }[] = [
    { t: input.exerciseEnd, bpm: input.hrAtEnd },
    ...sorted.filter((s) => s.t > input.exerciseEnd),
  ];
  const slopePerSecond = linearRegressionSlope(regressionPoints);
  const recoverySlopeBpmPerMin = slopePerSecond * 60;

  const lastSample = regressionPoints[regressionPoints.length - 1] as { t: EpochSeconds; bpm: number };
  const remainingBpm = lastSample.bpm - input.hrRest;

  let estimatedRecoveryMinutes: number | undefined;
  if (remainingBpm <= 0) {
    estimatedRecoveryMinutes = 0; // already at or below resting HR
  } else if (slopePerSecond < 0) {
    estimatedRecoveryMinutes = remainingBpm / -slopePerSecond / 60;
  } else {
    estimatedRecoveryMinutes = undefined; // not measurably recovering (flat/rising HR)
  }

  return { kind: 'ok', value: { hrr1, hrr2, recoverySlopeBpmPerMin, estimatedRecoveryMinutes } };
}

// ---------------------------------------------------------------------------
// Shared math helpers
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Largest |value - mean| / mean across the set, as a fraction (0.03 = 3%). */
function maxDeviationRatio_(values: readonly number[], meanValue: number): number {
  if (meanValue === 0) return values.every((v) => v === 0) ? 0 : Infinity;
  return Math.max(...values.map((v) => Math.abs(v - meanValue) / meanValue));
}

function findClosestSample(
  samples: readonly HrSample[],
  targetT: EpochSeconds,
  toleranceSeconds: number,
): HrSample | undefined {
  let best: HrSample | undefined;
  let bestDistance = Infinity;
  for (const s of samples) {
    const distance = Math.abs(s.t - targetT);
    if (distance <= toleranceSeconds && distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }
  return best;
}

/** Ordinary least-squares slope (bpm per second) of bpm vs t. */
function linearRegressionSlope(points: readonly { t: EpochSeconds; bpm: number }[]): number {
  const meanT = mean(points.map((p) => p.t));
  const meanBpm = mean(points.map((p) => p.bpm));

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.t - meanT) * (p.bpm - meanBpm);
    denominator += (p.t - meanT) ** 2;
  }
  if (denominator === 0) return 0; // all samples at the same timestamp -- degenerate, no slope
  return numerator / denominator;
}
