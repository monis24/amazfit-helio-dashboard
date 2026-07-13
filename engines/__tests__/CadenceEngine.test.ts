import { cadenceByHrZone, type CadenceSegment } from '../CadenceEngine';
import type { HrSample } from '../BiometricEngine';

describe('cadenceByHrZone', () => {
  const hrMax = 200;

  it('reports insufficient-data for an invalid hrMax', () => {
    const result = cadenceByHrZone({ segments: [], hr: [], hrMax: 0 });
    expect(result.kind).toBe('insufficient-data');
  });

  it('reports insufficient-data when no segment has an overlapping, in-zone HR sample', () => {
    const segments: CadenceSegment[] = [{ startUtc: 0, endUtc: 600, steps: 1200 }];
    const hr: HrSample[] = [{ t: 5000, bpm: 110 }]; // outside the segment window
    const result = cadenceByHrZone({ segments, hr, hrMax });
    expect(result.kind).toBe('insufficient-data');
  });

  it('skips segments whose average HR falls below Z1 (< 50% hrMax)', () => {
    const segments: CadenceSegment[] = [{ startUtc: 0, endUtc: 600, steps: 1200 }];
    const hr: HrSample[] = [{ t: 100, bpm: 50 }]; // 25% of hrMax
    const result = cadenceByHrZone({ segments, hr, hrMax });
    expect(result.kind).toBe('insufficient-data');
  });

  it('buckets cadence by HR zone and accumulates minutes within the same bucket', () => {
    const segments: CadenceSegment[] = [
      { startUtc: 0, endUtc: 600, steps: 1200 }, // 10min, 120 spm, avg HR 110 (55%) -> Z1
      { startUtc: 600, endUtc: 1200, steps: 1300 }, // 10min, 130 spm, avg HR 125 (62.5%) -> Z2
      { startUtc: 1200, endUtc: 1800, steps: 1200 }, // 10min, 120 spm, avg HR 110 (55%) -> Z1, same bucket as segment 1
      { startUtc: 1800, endUtc: 2400, steps: 1200 }, // no overlapping HR -> skipped
      { startUtc: 2400, endUtc: 3000, steps: 600 }, // avg HR 50 (25%) -> below Z1, skipped
    ];
    const hr: HrSample[] = [
      { t: 100, bpm: 110 },
      { t: 700, bpm: 125 },
      { t: 1300, bpm: 110 },
      { t: 2500, bpm: 50 },
    ];

    const result = cadenceByHrZone({ segments, hr, hrMax });
    expect(result).toEqual({
      kind: 'ok',
      value: [
        { zone: 'Z1', cadenceBuckets: [{ stepsPerMin: 120, minutes: 20 }] },
        { zone: 'Z2', cadenceBuckets: [{ stepsPerMin: 120, minutes: 10 }] },
      ],
    });
  });

  it('respects a custom cadenceBucketWidth', () => {
    const segments: CadenceSegment[] = [{ startUtc: 0, endUtc: 600, steps: 1250 }]; // 125 spm
    const hr: HrSample[] = [{ t: 100, bpm: 110 }]; // Z1
    const result = cadenceByHrZone({ segments, hr, hrMax, cadenceBucketWidth: 5 });
    expect(result).toEqual({
      kind: 'ok',
      value: [{ zone: 'Z1', cadenceBuckets: [{ stepsPerMin: 125, minutes: 10 }] }],
    });
  });

  it('ignores zero/negative-duration segments', () => {
    const segments: CadenceSegment[] = [{ startUtc: 100, endUtc: 100, steps: 0 }];
    const hr: HrSample[] = [{ t: 100, bpm: 110 }];
    const result = cadenceByHrZone({ segments, hr, hrMax });
    expect(result.kind).toBe('insufficient-data');
  });
});
