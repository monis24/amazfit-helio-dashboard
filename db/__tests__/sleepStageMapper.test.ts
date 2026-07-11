import { mapSleepSummaryToSession, SleepAnchoringError } from '../mappers/sleepStageMapper';
import type { DecodedBandSummary } from '../../types/ZeppApiSchemas';

// Regression fixture reproducing the exact live shape from Phase 0 discovery
// (2026-07-07, tz=-25200): segment minute-offsets anchor to midnight of the
// day BEFORE date_time, not date_time's own midnight. Values below are the
// real numbers that caught this — see FIELD_INVENTORY.md / the post-Phase-0
// replanning checkpoint.
function buildLiveShapeSummary(): DecodedBandSummary {
  return {
    goal: 8000,
    algv: '2.13.14',
    isMerged: 0,
    stp: { runCal: 0, cal: 0, conAct: 0, ncal: 0, ttl: 0, dis: 0, rn: 0, wk: 0, stage: [], runDist: 0 },
    tz: '-25200',
    v: 6,
    sn: 'TEST',
    iOS: '202606241915',
    slp: {
      pe: 0,
      wk: 32,
      wc: 8,
      ed: 1783440300,
      ebt: 603,
      supNap: true,
      dp: 76,
      lb: 58,
      odd_stage: [],
      is: 2,
      stage: [
        { start: 1656, stop: 1666, mode: 4 },
        { start: 1667, stop: 1723, mode: 5 },
        { start: 1724, stop: 1737, mode: 4 },
        { start: 1738, stop: 1764, mode: 8 },
        { start: 1765, stop: 1808, mode: 4 },
        { start: 1809, stop: 1819, mode: 5 },
        { start: 1820, stop: 1827, mode: 4 },
        { start: 1828, stop: 1841, mode: 8 },
        { start: 1842, stop: 1844, mode: 4 },
        { start: 1845, stop: 1848, mode: 7 },
        { start: 1849, stop: 1849, mode: 4 },
        { start: 1850, stop: 1858, mode: 7 },
        { start: 1859, stop: 1887, mode: 4 },
        { start: 1888, stop: 1895, mode: 5 },
        { start: 1896, stop: 1919, mode: 4 },
        { start: 1920, stop: 1923, mode: 8 },
        { start: 1924, stop: 1926, mode: 4 },
        { start: 1927, stop: 1927, mode: 7 },
        { start: 1928, stop: 1961, mode: 4 },
        { start: 1962, stop: 1962, mode: 7 },
        { start: 1963, stop: 1963, mode: 4 },
        { start: 1964, stop: 1965, mode: 7 },
        { start: 1966, stop: 1966, mode: 4 },
        { start: 1967, stop: 1977, mode: 7 },
        { start: 1978, stop: 1978, mode: 4 },
        { start: 1979, stop: 1980, mode: 7 },
        { start: 1981, stop: 1981, mode: 4 },
        { start: 1982, stop: 1983, mode: 7 },
        { start: 1984, stop: 1984, mode: 4 },
      ],
      napSleepSource: 0,
      isMerged: 0,
      napAlgoVersion: '4.0.17',
      supRem: true,
      lt: 176,
      rhr: 60,
      sleepScoreVersion: '1.0.2',
      selected: 0,
      ps: 0,
      dt: 45,
      ss: 35,
      sleepAlgoVersion: '4.0.17',
      st: 1783420560,
      sleepSource: 0,
    },
    hr: { maxHr: { hr: 0, ts: 0 } },
    byteLength: 8,
    sync: 0,
  };
}

describe('mapSleepSummaryToSession', () => {
  it('anchors to midnight of the day BEFORE date_time, matching the live-verified reference values exactly', () => {
    const session = mapSleepSummaryToSession('2026-07-07', buildLiveShapeSummary());

    expect(session.startUtc).toBe(1783420560); // slp.st
    expect(session.endUtc).toBe(1783440300); // slp.ed
    expect(session.segments[0]?.startUtc).toBe(1783420560);
    expect(session.segments[session.segments.length - 1]?.endUtc).toBe(1783440300);
  });

  it('would have shifted by 24h if anchored to date_time\'s own midnight instead — the bug this guards against', () => {
    const decoded = buildLiveShapeSummary();
    const session = mapSleepSummaryToSession('2026-07-07', decoded);
    const wrongAnchorFirstStart = session.segments[0]!.startUtc + 86400;
    // Sanity: the "obvious but wrong" anchor is exactly one day off from the
    // correct, live-verified one — demonstrating why the assertion matters.
    expect(wrongAnchorFirstStart).not.toBe(decoded.slp.st);
    expect(wrongAnchorFirstStart - decoded.slp.st).toBe(86400);
  });

  it('rejects a payload where the anchoring assertion fails, rather than storing silently-wrong times', () => {
    const decoded = buildLiveShapeSummary();
    // Corrupt slp.st so it can never match the anchored first segment.
    const corrupted: DecodedBandSummary = { ...decoded, slp: { ...decoded.slp, st: decoded.slp.st + 999 } };
    expect(() => mapSleepSummaryToSession('2026-07-07', corrupted)).toThrow(SleepAnchoringError);
  });

  it('rejects a record with no stage segments', () => {
    const decoded = buildLiveShapeSummary();
    const empty: DecodedBandSummary = { ...decoded, slp: { ...decoded.slp, stage: [] } };
    expect(() => mapSleepSummaryToSession('2026-07-07', empty)).toThrow(SleepAnchoringError);
  });

  it('rejects an invalid tz offset', () => {
    const decoded = buildLiveShapeSummary();
    const badTz: DecodedBandSummary = { ...decoded, tz: 'not-a-number' };
    expect(() => mapSleepSummaryToSession('2026-07-07', badTz)).toThrow(SleepAnchoringError);
  });

  it('carries deep_min from slp.dp and rem_min from slp.dt (confirmed live: dt sums to REM despite the name)', () => {
    const session = mapSleepSummaryToSession('2026-07-07', buildLiveShapeSummary());
    expect(session.deepMin).toBe(76);
    expect(session.remMin).toBe(45);
    expect(session.awakeMin).toBe(32);
    expect(session.lightMin).toBe(176);
  });
});
