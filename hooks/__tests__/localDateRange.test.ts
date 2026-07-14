import { localDayWindow, paddedLocalDateRange, shiftLocalDate, todayLocalDate } from '../localDateRange';

describe('todayLocalDate', () => {
  it('formats a given Date using local calendar fields, not UTC', () => {
    const d = new Date(2026, 6, 8, 23, 30, 0); // local July 8, 2026, 23:30
    expect(todayLocalDate(d)).toBe('2026-07-08');
  });

  it('pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5, 12, 0, 0); // local Jan 5, 2026
    expect(todayLocalDate(d)).toBe('2026-01-05');
  });
});

describe('paddedLocalDateRange', () => {
  it('pads a day on each side of the given UTC window', () => {
    const fromUtc = Date.UTC(2026, 6, 8, 12, 0, 0) / 1000;
    const toUtc = Date.UTC(2026, 6, 8, 18, 0, 0) / 1000;
    expect(paddedLocalDateRange(fromUtc, toUtc)).toEqual({ from: '2026-07-07', to: '2026-07-09' });
  });
});

describe('localDayWindow', () => {
  it('spans exactly 24 hours (86400s) from local midnight to the next local midnight', () => {
    const { fromUtc, toUtc } = localDayWindow('2026-07-08');
    expect(toUtc - fromUtc).toBe(86400);
  });

  it('the window start matches todayLocalDate() of a Date built from fromUtc', () => {
    const { fromUtc } = localDayWindow('2026-07-08');
    expect(todayLocalDate(new Date(fromUtc * 1000))).toBe('2026-07-08');
  });
});

describe('shiftLocalDate', () => {
  it('shifts forward within a month', () => {
    expect(shiftLocalDate('2026-07-08', 1)).toBe('2026-07-09');
  });

  it('shifts backward within a month', () => {
    expect(shiftLocalDate('2026-07-08', -1)).toBe('2026-07-07');
  });

  it('rolls over a month boundary', () => {
    expect(shiftLocalDate('2026-07-31', 1)).toBe('2026-08-01');
  });

  it('rolls over a year boundary', () => {
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rolls backward over a month boundary', () => {
    expect(shiftLocalDate('2026-08-01', -1)).toBe('2026-07-31');
  });
});
