import { localMidnightUtc, segmentAnchorUtc, hrBlobAnchorUtc } from '../mappers/dayAnchor';

describe('dayAnchor', () => {
  it('localMidnightUtc computes midnight of the given date under the given tz offset', () => {
    // UTC-7 (-25200s): local midnight on 2026-07-08 is 07:00 UTC that day.
    expect(localMidnightUtc('2026-07-08', -25200)).toBe(Date.UTC(2026, 6, 8, 7, 0, 0) / 1000);
  });

  it('segmentAnchorUtc (sleep/step) anchors one day BEFORE date_time -- confirmed via slp.st/ed (see sleepStageMapper.test.ts)', () => {
    expect(segmentAnchorUtc('2026-07-08', -25200)).toBe(localMidnightUtc('2026-07-08', -25200) - 86400);
  });

  it('hrBlobAnchorUtc anchors to date_time\'s OWN midnight -- a DIFFERENT convention than segments', () => {
    const dateTime = '2026-07-08';
    const tz = -25200;
    expect(hrBlobAnchorUtc(dateTime, tz)).toBe(localMidnightUtc(dateTime, tz));
    expect(hrBlobAnchorUtc(dateTime, tz)).not.toBe(segmentAnchorUtc(dateTime, tz));
  });

  it('regression: the real sleep window for 2026-07-08 only lands in-range [0,1440) under the HR blob anchor, not the segment anchor', () => {
    // Live-verified numbers from a real synced account (sleep_sessions row
    // for local_date=2026-07-08) -- this is the exact empirical check that
    // resolved the post-Phase-2 Fable checkpoint's finding that the two
    // band_data.json record types (detail vs summary) do NOT share one
    // anchor convention.
    const dateTime = '2026-07-08';
    const tz = -25200;
    const sleepStartUtc = 1783503000;
    const sleepEndUtc = 1783526760;

    const hrAnchor = hrBlobAnchorUtc(dateTime, tz);
    const hrStartIdx = (sleepStartUtc - hrAnchor) / 60;
    const hrEndIdx = (sleepEndUtc - hrAnchor) / 60;
    expect(hrStartIdx).toBeGreaterThanOrEqual(0);
    expect(hrEndIdx).toBeLessThanOrEqual(1440);

    const segAnchor = segmentAnchorUtc(dateTime, tz);
    const segStartIdx = (sleepStartUtc - segAnchor) / 60;
    // Under the segment convention, the same real window falls entirely
    // outside a single day's valid minute range -- not just "wrong", but
    // not even a plausible candidate.
    expect(segStartIdx).toBeGreaterThanOrEqual(1440);
  });
});
