import { restlessnessProxy, type SleepStageInterval } from '../RestlessnessEngine';

describe('restlessnessProxy', () => {
  it('returns [] for an empty session', () => {
    expect(restlessnessProxy([], 10)).toEqual([]);
  });

  it('returns [] for a single-segment session (nothing to transition between)', () => {
    const intervals: SleepStageInterval[] = [{ startUtc: 0, endUtc: 1800, stage: 4 }];
    expect(restlessnessProxy(intervals, 10)).toEqual([]);
  });

  it('returns [] for a non-positive bucketMinutes', () => {
    const intervals: SleepStageInterval[] = [
      { startUtc: 0, endUtc: 600, stage: 4 },
      { startUtc: 600, endUtc: 1200, stage: 5 },
    ];
    expect(restlessnessProxy(intervals, 0)).toEqual([]);
  });

  it('scores transition density per bucket, emitting zero-score buckets', () => {
    const intervals: SleepStageInterval[] = [
      { startUtc: 0, endUtc: 600, stage: 4 },
      { startUtc: 600, endUtc: 1200, stage: 5 },
      { startUtc: 1200, endUtc: 1800, stage: 4 },
    ];
    const result = restlessnessProxy(intervals, 10);
    expect(result).toEqual([
      { t: 0, score: 0 },
      { t: 600, score: 1 },
      { t: 1200, score: 1 },
    ]);
  });

  it('counts multiple transitions landing in the same bucket', () => {
    const intervals: SleepStageInterval[] = [
      { startUtc: 0, endUtc: 100, stage: 4 },
      { startUtc: 100, endUtc: 200, stage: 5 },
      { startUtc: 200, endUtc: 300, stage: 4 },
      { startUtc: 300, endUtc: 400, stage: 8 },
    ];
    const result = restlessnessProxy(intervals, 10); // one 600s bucket covers [0, 400)
    expect(result).toEqual([{ t: 0, score: 3 }]);
  });

  it('does not count a boundary between two segments sharing the same stage as a transition', () => {
    const intervals: SleepStageInterval[] = [
      { startUtc: 0, endUtc: 300, stage: 4 },
      { startUtc: 300, endUtc: 600, stage: 4 }, // same stage as previous — not a real transition
      { startUtc: 600, endUtc: 900, stage: 5 },
    ];
    const result = restlessnessProxy(intervals, 10);
    expect(result).toEqual([
      { t: 0, score: 0 },
      { t: 600, score: 1 },
    ]);
  });

  it('sorts out-of-order input by startUtc before bucketing', () => {
    const intervals: SleepStageInterval[] = [
      { startUtc: 600, endUtc: 1200, stage: 5 },
      { startUtc: 0, endUtc: 600, stage: 4 },
    ];
    const result = restlessnessProxy(intervals, 10);
    expect(result).toEqual([
      { t: 0, score: 0 },
      { t: 600, score: 1 },
    ]);
  });
});
