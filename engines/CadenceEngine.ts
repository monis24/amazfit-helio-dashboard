/**
 * CadenceEngine.ts — sketched during the post-Phase-0 replanning pass,
 * deliberately scoped out of Phase 2's BiometricEngine.ts. Feeds the
 * Cadence & Efficiency panel's histogram.
 *
 * Primary source is daily `stp.stage` activity segments (db/schema.ts's
 * step_segments), not workout streams — per SPEC.md's Phase 3 redirect,
 * given the live blocker that this account has zero recorded workouts.
 * Workout-stream segments fit the same `CadenceSegment` shape and would
 * enrich this when present, but nothing here assumes they exist.
 *
 * Same purity contract as BiometricEngine.ts: no /db access, no Date.now().
 * Reuses HrSample/EpochSeconds/EngineResult from BiometricEngine.ts rather
 * than redefining them — same domain, same file family.
 */

import type { EngineResult, EpochSeconds, HrSample } from './BiometricEngine';

export interface CadenceSegment {
  readonly startUtc: EpochSeconds;
  readonly endUtc: EpochSeconds;
  readonly steps: number;
}

export interface CadenceBucket {
  /** Lower bound of this cadence bucket (e.g. 120 = "120-139 steps/min"). */
  readonly stepsPerMin: number;
  /** Total segment-duration minutes falling in this (zone, cadence-bucket) cell. */
  readonly minutes: number;
}

export interface CadenceZoneResult {
  readonly zone: string;
  readonly cadenceBuckets: readonly CadenceBucket[];
}

export interface CadenceByHrZoneInput {
  readonly segments: readonly CadenceSegment[];
  readonly hr: readonly HrSample[];
  readonly hrMax: number;
  /** Width of each cadence histogram bucket in steps/min. */
  readonly cadenceBucketWidth?: number;
}

interface ZoneDef {
  readonly zone: string;
  readonly minFraction: number;
  readonly maxFraction: number;
}

/** Standard 5-zone %HRmax model. Below Z1 (< 50% HRmax) is resting/idle
 *  activity, not a cardio zone worth bucketing here. */
const ZONES: readonly ZoneDef[] = [
  { zone: 'Z1', minFraction: 0.5, maxFraction: 0.6 },
  { zone: 'Z2', minFraction: 0.6, maxFraction: 0.7 },
  { zone: 'Z3', minFraction: 0.7, maxFraction: 0.8 },
  { zone: 'Z4', minFraction: 0.8, maxFraction: 0.9 },
  { zone: 'Z5', minFraction: 0.9, maxFraction: Infinity },
];

function zoneForFraction(fraction: number): string | undefined {
  return ZONES.find((z) => fraction >= z.minFraction && fraction < z.maxFraction)?.zone;
}

/**
 * Buckets step-cadence segments by the HR zone the wearer was in during each
 * segment (average HR over the segment's window), then histograms
 * steps/min within each zone. Segments with no overlapping HR sample, or
 * whose average HR falls below Z1, are skipped — "no zone" rather than
 * forced into one.
 */
export function cadenceByHrZone(input: CadenceByHrZoneInput): EngineResult<readonly CadenceZoneResult[]> {
  if (!Number.isFinite(input.hrMax) || input.hrMax <= 0) {
    return { kind: 'insufficient-data', reason: `invalid hrMax ${input.hrMax}` };
  }
  const cadenceBucketWidth = input.cadenceBucketWidth ?? 20;

  // zone -> bucketFloor -> accumulated minutes
  const accum = new Map<string, Map<number, number>>();

  for (const seg of input.segments) {
    const durationMinutes = (seg.endUtc - seg.startUtc) / 60;
    if (durationMinutes <= 0) continue;

    const overlappingHr = input.hr.filter((s) => s.t >= seg.startUtc && s.t < seg.endUtc);
    if (overlappingHr.length === 0) continue;

    const avgHr = overlappingHr.reduce((sum, s) => sum + s.bpm, 0) / overlappingHr.length;
    const zone = zoneForFraction(avgHr / input.hrMax);
    if (zone === undefined) continue;

    const stepsPerMin = seg.steps / durationMinutes;
    const bucketFloor = Math.floor(stepsPerMin / cadenceBucketWidth) * cadenceBucketWidth;

    const zoneMap = accum.get(zone) ?? new Map<number, number>();
    zoneMap.set(bucketFloor, (zoneMap.get(bucketFloor) ?? 0) + durationMinutes);
    accum.set(zone, zoneMap);
  }

  if (accum.size === 0) {
    return {
      kind: 'insufficient-data',
      reason: 'no cadence segment had an overlapping HR sample in a defined HR zone',
    };
  }

  const result: CadenceZoneResult[] = ZONES.filter((z) => accum.has(z.zone)).map((z) => {
    const zoneMap = accum.get(z.zone) as Map<number, number>;
    const cadenceBuckets = [...zoneMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([stepsPerMin, minutes]) => ({ stepsPerMin, minutes }));
    return { zone: z.zone, cadenceBuckets };
  });

  return { kind: 'ok', value: result };
}
