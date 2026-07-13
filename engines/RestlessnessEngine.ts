/**
 * RestlessnessEngine.ts — sketched during the post-Phase-0 replanning pass,
 * deliberately scoped out of Phase 2's BiometricEngine.ts. Feeds the Sleep
 * Hypnogram's companion restlessness graph.
 *
 * Stage-transition-density proxy, per SPEC.md's Phase 3 Hypnogram section:
 * no cloud endpoint exposes raw accelerometer data (confirmed during the
 * post-Phase-0 replanning pass — see SPEC.md's BLE research note for the
 * researched-but-not-pursued alternative), so transition density across
 * fixed-width time buckets stands in for a true motion signal. More stage
 * flips in a bucket reads as more restless sleep in that window.
 *
 * Intentionally decoupled from /types/ZeppApiSchemas's SleepStageMode (a
 * wire-shape concern) — this file never knows /db, base64, or wire formats
 * exist, matching BiometricEngine.ts's purity contract. `stage` is opaque
 * here; only the boundaries between segments matter, not what a stage means.
 */

export type EpochSeconds = number;

/** One sleep-stage segment, already anchored to epoch seconds by /hooks
 *  (db/mappers/dayAnchor.ts's segmentAnchorUtc) — this file never anchors. */
export interface SleepStageInterval {
  readonly startUtc: EpochSeconds;
  readonly endUtc: EpochSeconds;
  /** Opaque stage identifier — only used to detect that a transition occurred. */
  readonly stage: number;
}

export interface RestlessnessPoint {
  readonly t: EpochSeconds;
  readonly score: number;
}

/**
 * Buckets a sleep session into `bucketMinutes`-wide windows spanning its
 * full start-to-end range and scores each bucket by how many stage
 * transitions (segment boundaries after the first) fall inside it. Emits
 * one point per bucket, including zero-transition buckets — the Hypnogram's
 * companion graph needs a continuous x-axis, not just the buckets with
 * activity.
 *
 * Returns `[]` for no/single-segment input (nothing to transition between) —
 * a plain empty result rather than EngineResult, since "no restlessness
 * signal for an empty sleep session" isn't a fallible computation, it's the
 * correct answer.
 */
export function restlessnessProxy(
  intervals: readonly SleepStageInterval[],
  bucketMinutes: number,
): readonly RestlessnessPoint[] {
  if (intervals.length < 2 || bucketMinutes <= 0) return [];

  const sorted = [...intervals].sort((a, b) => a.startUtc - b.startUtc);
  const sessionStart = (sorted[0] as SleepStageInterval).startUtc;
  const sessionEnd = sorted.reduce((max, seg) => Math.max(max, seg.endUtc), sessionStart);

  // Transitions are every segment boundary after the first segment's own
  // start (which isn't a transition — there's no prior stage to flip from).
  const transitionTimes = sorted.slice(1).map((seg) => seg.startUtc);

  const bucketSeconds = bucketMinutes * 60;
  const points: RestlessnessPoint[] = [];
  for (let bucketStart = sessionStart; bucketStart < sessionEnd; bucketStart += bucketSeconds) {
    const bucketEnd = bucketStart + bucketSeconds;
    const score = transitionTimes.filter((t) => t >= bucketStart && t < bucketEnd).length;
    points.push({ t: bucketStart, score });
  }

  return points;
}
