import {
  decodeHrMinutes,
  decodeBandSummary,
  decodeStressData,
  decodeSpo2Extra,
  ageFromBirthday,
  SLEEP_STAGE_LABELS,
} from '../ZeppApiSchemas';

// Fixtures are synthetic but shape-identical to the live samples confirmed
// during Phase 0 discovery (see FIELD_INVENTORY.md) — fabricated values, not
// real account data, so they're safe to commit and don't depend on
// scripts/discovery-output/ (gitignored, real biometric data).
//
// Building base64 fixtures with Node's Buffer here is fine: this is test-only
// code that runs under Jest/Node, not the production decode path, which
// stays dependency-free for RN per the module's portability note.

function base64Encode(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('base64');
}

function jsonToBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}

describe('decodeHrMinutes', () => {
  it('decodes a full day of HR bytes, preserving the no-reading sentinel', () => {
    const bytes = [...Array(1439).fill(72), 254];
    const decoded = decodeHrMinutes(base64Encode(bytes));
    expect(decoded).toHaveLength(1440);
    expect(decoded[0]).toBe(72);
    expect(decoded[1439]).toBe(254);
  });
});

describe('decodeBandSummary', () => {
  function buildSummary(stage: { start: number; stop: number; mode: 4 | 5 | 7 | 8 }[]) {
    const totals: Record<number, number> = { 4: 0, 5: 0, 7: 0, 8: 0 };
    for (const seg of stage) totals[seg.mode] = (totals[seg.mode] ?? 0) + (seg.stop - seg.start + 1);
    const sessionMinutes = Object.values(totals).reduce((a, b) => a + b, 0);
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
        wk: totals[7],
        wc: 1,
        ed: 1000 + sessionMinutes * 60,
        ebt: 0,
        supNap: false,
        dp: totals[5],
        lb: 0,
        odd_stage: [],
        is: 2,
        stage,
        napSleepSource: 0,
        isMerged: 0,
        napAlgoVersion: '4.0.17',
        supRem: true,
        lt: totals[4],
        rhr: 55,
        sleepScoreVersion: '1.0.2',
        selected: 0,
        ps: 0,
        dt: totals[8],
        ss: 0,
        sleepAlgoVersion: '4.0.17',
        st: 1000,
        sleepSource: 0,
      },
      hr: { maxHr: { hr: 0, ts: 0 } },
      byteLength: 8,
      sync: 0,
    };
  }

  it('decodes sleep stage segments whose durations sum to the record totals', () => {
    const stage: { start: number; stop: number; mode: 4 | 5 | 7 | 8 }[] = [
      { start: 0, stop: 59, mode: 4 }, // 60 light
      { start: 60, stop: 119, mode: 5 }, // 60 deep
      { start: 120, stop: 124, mode: 7 }, // 5 awake
      { start: 125, stop: 144, mode: 8 }, // 20 rem
    ];
    const decoded = decodeBandSummary(jsonToBase64(buildSummary(stage)));

    expect(decoded.slp.lt).toBe(60);
    expect(decoded.slp.dp).toBe(60);
    expect(decoded.slp.wk).toBe(5);
    expect(decoded.slp.dt).toBe(20);

    const totalMinutes = decoded.slp.stage.reduce((sum, seg) => sum + (seg.stop - seg.start + 1), 0);
    const sessionMinutes = (decoded.slp.ed - decoded.slp.st) / 60;
    expect(totalMinutes).toBe(sessionMinutes);
  });

  it('labels all four confirmed sleep stage modes', () => {
    expect(SLEEP_STAGE_LABELS).toEqual({ 4: 'Light', 5: 'Deep', 7: 'Awake', 8: 'REM' });
  });

  it('throws on a payload missing the confirmed shape', () => {
    expect(() => decodeBandSummary(jsonToBase64({ notASummary: true }))).toThrow();
  });
});

describe('decodeStressData', () => {
  it('decodes a {time, value} time series', () => {
    const points = [
      { time: 1783066500000, value: 34 },
      { time: 1783066800000, value: 28 },
    ];
    const decoded = decodeStressData(JSON.stringify(points));
    expect(decoded).toEqual(points);
  });

  it('throws on a malformed point', () => {
    expect(() => decodeStressData(JSON.stringify([{ time: 1, notValue: 2 }]))).toThrow();
  });
});

describe('decodeSpo2Extra', () => {
  it('decodes spo2History and the scalar spo2 reading', () => {
    const extra = {
      spo2History: [99, 99, 0, 0],
      deviceSource: 10289411,
      sn: 'TEST',
      timestamp: 1783315231000,
      timezone: 'America/Los_Angeles',
      deviceId: 'TEST',
      spo2: 99,
      subType: 'click',
      isAuto: false,
    };
    const decoded = decodeSpo2Extra(JSON.stringify(extra));
    expect(decoded.spo2).toBe(99);
    expect(decoded.spo2History).toHaveLength(4);
  });

  it('throws when spo2History is missing', () => {
    expect(() => decodeSpo2Extra(JSON.stringify({ spo2: 99 }))).toThrow();
  });
});

describe('ageFromBirthday', () => {
  // Constructed with the local-time Date(year, monthIndex, day) form, not an
  // ISO string, since ageFromBirthday reads getFullYear()/getMonth() in local
  // time — an ISO string parses as UTC and can silently roll to a different
  // local date/month near a timezone boundary.
  it('computes age from a "YYYY-MM" birthday as of a fixed date', () => {
    expect(ageFromBirthday('2001-03', new Date(2026, 6, 10))).toBe(25);
  });

  it('floors to the birth month boundary', () => {
    expect(ageFromBirthday('2000-01', new Date(2026, 0, 1))).toBe(26);
    expect(ageFromBirthday('2000-02', new Date(2026, 0, 1))).toBe(25);
  });

  it('rejects a malformed birthday', () => {
    expect(() => ageFromBirthday('not-a-date')).toThrow();
  });
});
