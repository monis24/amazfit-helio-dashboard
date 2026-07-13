import { stressSevenDayTrend, type StressDaySummary } from '../StressTrendEngine';

function day(localDate: string, avgStress: number | null): StressDaySummary {
  return { localDate, avgStress };
}

describe('stressSevenDayTrend', () => {
  it('reports insufficient-data with fewer than 2 recorded days', () => {
    const result = stressSevenDayTrend({ days: [day('2026-07-01', 40)] });
    expect(result.kind).toBe('insufficient-data');
  });

  it('reports insufficient-data when all days are null', () => {
    const result = stressSevenDayTrend({ days: [day('2026-07-01', null), day('2026-07-02', null)] });
    expect(result.kind).toBe('insufficient-data');
  });

  it('detects an upward trend', () => {
    const days = [
      day('2026-07-01', 20),
      day('2026-07-02', 22),
      day('2026-07-03', 24),
      day('2026-07-04', 40),
      day('2026-07-05', 42),
      day('2026-07-06', 44),
    ];
    const result = stressSevenDayTrend({ days });
    expect(result).toEqual({ kind: 'ok', value: { direction: 'up', deltaAvg: 20 } });
  });

  it('detects a downward trend', () => {
    const days = [day('2026-07-01', 50), day('2026-07-02', 50), day('2026-07-03', 10), day('2026-07-04', 10)];
    const result = stressSevenDayTrend({ days });
    expect(result).toEqual({ kind: 'ok', value: { direction: 'down', deltaAvg: -40 } });
  });

  it('treats a small delta as flat, using the default threshold', () => {
    const days = [day('2026-07-01', 40), day('2026-07-02', 41)];
    const result = stressSevenDayTrend({ days });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.direction).toBe('flat');
    }
  });

  it('ignores null days and sorts out of order input by localDate', () => {
    const days = [
      day('2026-07-04', 40),
      day('2026-07-01', 20),
      day('2026-07-03', null),
      day('2026-07-02', 20),
    ];
    const result = stressSevenDayTrend({ days });
    expect(result).toEqual({ kind: 'ok', value: { direction: 'up', deltaAvg: 20 } });
  });

  it('respects a custom flatThreshold', () => {
    const days = [day('2026-07-01', 40), day('2026-07-02', 45)];
    const result = stressSevenDayTrend({ days, flatThreshold: 10 });
    expect(result).toEqual({ kind: 'ok', value: { direction: 'flat', deltaAvg: 5 } });
  });
});
