import {
  computeRestingHr,
  gellishHrMax,
  vo2MaxModelA,
  vo2MaxModelB,
  computeHrr,
  type HrSample,
  type WorkoutStreamSample,
} from '../BiometricEngine';

/** Minute-cadence HR samples from t=0 to t=durationMinutes*60, all at `baseline`,
 *  except minutes in [dipStartMinute, dipEndMinute) which are `dipValue`. */
function buildHrSeries(durationMinutes: number, baseline: number, dip?: { start: number; end: number; value: number }): HrSample[] {
  const samples: HrSample[] = [];
  for (let minute = 0; minute <= durationMinutes; minute += 1) {
    const inDip = dip !== undefined && minute >= dip.start && minute < dip.end;
    samples.push({ t: minute * 60, bpm: inDip ? dip.value : baseline });
  }
  return samples;
}

describe('computeRestingHr', () => {
  it('finds the lowest 5-minute rolling average within the final searchWindowMinutes', () => {
    const samples = buildHrSeries(60, 70, { start: 25, end: 35, value: 50 });
    const result = computeRestingHr({ samples, sleepEnd: 3600 });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.hrRest).toBe(50);
      expect(result.value.windowStart).toBeGreaterThanOrEqual(25 * 60);
      expect(result.value.windowStart).toBeLessThan(35 * 60);
    }
  });

  it('ignores samples outside the search window even if lower', () => {
    // Dip is at minute 5-10, well before the last 20 minutes searched.
    const samples = buildHrSeries(60, 70, { start: 5, end: 10, value: 30 });
    const result = computeRestingHr({ samples, sleepEnd: 3600, searchWindowMinutes: 20 });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.hrRest).toBe(70); // the 30bpm dip is outside the searched window
    }
  });

  it('returns insufficient-data when there are no samples in the search window at all', () => {
    const result = computeRestingHr({ samples: [], sleepEnd: 3600 });
    expect(result.kind).toBe('insufficient-data');
  });

  it('returns insufficient-data when no window meets the coverage threshold', () => {
    // Samples every 10 minutes -- a 5-minute window can contain at most 1 of them.
    const samples = [0, 600, 1200, 1800, 2400, 3000, 3600].map((t) => ({ t, bpm: 60 }));
    const result = computeRestingHr({ samples, sleepEnd: 3600, minCoverageRatio: 0.6 });
    expect(result.kind).toBe('insufficient-data');
  });

  it('respects a lower minCoverageRatio, accepting sparser windows', () => {
    const samples = [0, 600, 1200, 1800, 2400, 3000, 3600].map((t) => ({ t, bpm: 60 }));
    const result = computeRestingHr({ samples, sleepEnd: 3600, minCoverageRatio: 0.1 });
    expect(result.kind).toBe('ok');
  });

  it('respects custom rollingWindowMinutes', () => {
    const samples = buildHrSeries(60, 70, { start: 25, end: 27, value: 50 }); // only a 2-minute dip
    // A 5-minute rolling window straddling the dip will average higher than 50.
    const wideWindow = computeRestingHr({ samples, sleepEnd: 3600, rollingWindowMinutes: 5 });
    expect(wideWindow.kind).toBe('ok');
    if (wideWindow.kind === 'ok') expect(wideWindow.value.hrRest).toBeGreaterThan(50);

    // A 2-minute rolling window can land exactly on the dip.
    const narrowWindow = computeRestingHr({ samples, sleepEnd: 3600, rollingWindowMinutes: 2, minCoverageRatio: 1 });
    expect(narrowWindow.kind).toBe('ok');
    if (narrowWindow.kind === 'ok') expect(narrowWindow.value.hrRest).toBe(50);
  });
});

describe('gellishHrMax', () => {
  it('computes 207 - 0.7 * age', () => {
    expect(gellishHrMax(30)).toBeCloseTo(207 - 0.7 * 30, 10);
    expect(gellishHrMax(40)).toBeCloseTo(179, 10);
    expect(gellishHrMax(25)).toBeCloseTo(189.5, 10);
  });

  it('throws on non-positive age', () => {
    expect(() => gellishHrMax(0)).toThrow();
    expect(() => gellishHrMax(-5)).toThrow();
  });

  it('throws on non-finite age', () => {
    expect(() => gellishHrMax(NaN)).toThrow();
    expect(() => gellishHrMax(Infinity)).toThrow();
  });
});

describe('vo2MaxModelA', () => {
  it('computes 15.3 * (hrMax / hrRest)', () => {
    expect(vo2MaxModelA(180, 50)).toBeCloseTo(15.3 * (180 / 50), 10);
    expect(vo2MaxModelA(190, 60)).toBeCloseTo(15.3 * (190 / 60), 10);
  });

  it('throws on non-positive hrRest', () => {
    expect(() => vo2MaxModelA(180, 0)).toThrow();
    expect(() => vo2MaxModelA(180, -10)).toThrow();
  });

  it('throws on non-finite hrRest', () => {
    expect(() => vo2MaxModelA(180, NaN)).toThrow();
  });
});

describe('vo2MaxModelB', () => {
  const hrMax = 190;
  const hrRest = 50;

  /** A perfectly steady 4-minute stream at the given constant bpm/speed. */
  function steadyStream(bpm: number, speedMPerMin: number, seconds = 240): WorkoutStreamSample[] {
    const stream: WorkoutStreamSample[] = [];
    for (let t = 0; t <= seconds; t += 15) {
      stream.push({ t, bpm, speedMPerMin });
    }
    return stream;
  }

  it('extrapolates VO2 max from a steady-state window matching the ACSM/HRR formula by hand', () => {
    const bpm = 190 * 0.75; // 142.5, within the 65-85% band
    const speed = 150; // m/min
    const stream = steadyStream(bpm, speed);

    const result = vo2MaxModelB({ stream, hrMax, hrRest });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const expectedVo2Cost = 0.2 * speed + 3.5;
      const expectedVo2Max = ((hrMax - hrRest) / (bpm - hrRest)) * (expectedVo2Cost - 3.5) + 3.5;
      expect(result.value.vo2Max).toBeCloseTo(expectedVo2Max, 10);
      expect(result.value.hrExercise).toBeCloseTo(bpm, 10);
      expect(result.value.speedMPerMin).toBeCloseTo(speed, 10);

      // Hardcoded literal (not just a formula-mirror of the code under
      // test), independently hand-computed and cross-checked by the Phase 2
      // Fable checkpoint: vo2Cost=33.5, vo2Max=(140/92.5)*30+3.5=48.9054...
      // This is what actually catches a wrong constant baked into both the
      // implementation and a same-formula test.
      expect(result.value.vo2Max).toBeCloseTo(48.90540540540541, 10);
    }
  });

  it('returns no-speed-data when no sample has both HR and speed', () => {
    const stream: WorkoutStreamSample[] = [
      { t: 0, bpm: 140 },
      { t: 60, bpm: 142 },
    ];
    const result = vo2MaxModelB({ stream, hrMax, hrRest });
    expect(result.kind).toBe('insufficient-data');
    if (result.kind === 'insufficient-data') expect(result.reason).toMatch(/^no-speed-data/);
  });

  it('returns no-steady-state-window when HR/speed never stabilize', () => {
    const stream: WorkoutStreamSample[] = [];
    for (let t = 0; t <= 240; t += 15) {
      // Wildly varying bpm/speed -- never within 3% of the window's own mean.
      stream.push({ t, bpm: 140 + (t % 30), speedMPerMin: 150 + (t % 40) * 3 });
    }
    const result = vo2MaxModelB({ stream, hrMax, hrRest });
    expect(result.kind).toBe('insufficient-data');
    if (result.kind === 'insufficient-data') expect(result.reason).toMatch(/^no-steady-state-window/);
  });

  it('rejects a steady window outside the 65-85% HR band', () => {
    const tooLow = steadyStream(190 * 0.5, 150); // 50% of hrMax, below the 65% floor
    const resultLow = vo2MaxModelB({ stream: tooLow, hrMax, hrRest });
    expect(resultLow.kind).toBe('insufficient-data');

    const tooHigh = steadyStream(190 * 0.95, 150); // 95% of hrMax, above the 85% ceiling
    const resultHigh = vo2MaxModelB({ stream: tooHigh, hrMax, hrRest });
    expect(resultHigh.kind).toBe('insufficient-data');
  });

  it('respects minSamplesInWindow, rejecting a window with too few points', () => {
    // Only 2 points in the whole window -- below the default floor of 3.
    const stream: WorkoutStreamSample[] = [
      { t: 0, bpm: 142.5, speedMPerMin: 150 },
      { t: 239, bpm: 142.5, speedMPerMin: 150 },
    ];
    const result = vo2MaxModelB({ stream, hrMax, hrRest });
    expect(result.kind).toBe('insufficient-data');
  });

  it('honors a custom maxDeviationRatio', () => {
    const stream: WorkoutStreamSample[] = [];
    for (let t = 0; t <= 240; t += 15) {
      // ~5% swing around 142.5bpm -- fails the default 3% but passes a looser 10%.
      stream.push({ t, bpm: 142.5 * (t % 30 === 0 ? 1.05 : 0.95), speedMPerMin: 150 });
    }
    const strict = vo2MaxModelB({ stream, hrMax, hrRest, maxDeviationRatio: 0.03 });
    expect(strict.kind).toBe('insufficient-data');

    const loose = vo2MaxModelB({ stream, hrMax, hrRest, maxDeviationRatio: 0.1 });
    expect(loose.kind).toBe('ok');
  });
});

describe('computeHrr', () => {
  it('computes HRR1/HRR2 and a decreasing recovery slope matching a hand-fit line', () => {
    // HR decreasing linearly by 1 bpm every 10 seconds from 160 at exerciseEnd.
    const exerciseEnd = 1000;
    const hrAtEnd = 160;
    const postExercise: HrSample[] = [];
    for (let dt = 10; dt <= 180; dt += 10) {
      postExercise.push({ t: exerciseEnd + dt, bpm: hrAtEnd - dt / 10 });
    }
    const result = computeHrr({ postExercise, exerciseEnd, hrAtEnd, hrRest: 55 });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // At +60s, bpm = 160 - 6 = 154 -> HRR1 = 160 - 154 = 6.
    expect(result.value.hrr1).toBeCloseTo(6, 5);
    // At +120s, bpm = 160 - 12 = 148 -> HRR2 = 160 - 148 = 12.
    expect(result.value.hrr2).toBeCloseTo(12, 5);
    // Slope is -1 bpm per 10s = -6 bpm/min for a perfectly linear series.
    expect(result.value.recoverySlopeBpmPerMin).toBeCloseTo(-6, 5);
    // Last sample (t=1180, bpm=142) is 87 above hrRest=55; at 6bpm/min that's 14.5 min remaining.
    expect(result.value.estimatedRecoveryMinutes).toBeCloseTo(87 / 6, 5);
  });

  it('returns insufficient-data when no sample exists near the 1-minute mark', () => {
    const exerciseEnd = 1000;
    const postExercise: HrSample[] = [{ t: exerciseEnd + 300, bpm: 130 }]; // way past tolerance
    const result = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55 });
    expect(result.kind).toBe('insufficient-data');
  });

  it('returns hrr2 = undefined when no sample exists near the 2-minute mark, but hrr1 still succeeds', () => {
    const exerciseEnd = 1000;
    const postExercise: HrSample[] = [{ t: exerciseEnd + 60, bpm: 150 }]; // only the 1-minute sample
    const result = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55 });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.hrr1).toBe(10);
    expect(result.value.hrr2).toBeUndefined();
  });

  it('returns estimatedRecoveryMinutes = 0 when the last sample has already reached hrRest', () => {
    const exerciseEnd = 1000;
    const postExercise: HrSample[] = [
      { t: exerciseEnd + 60, bpm: 120 },
      { t: exerciseEnd + 120, bpm: 55 }, // already at resting HR
    ];
    const result = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55 });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.estimatedRecoveryMinutes).toBe(0);
  });

  it('returns estimatedRecoveryMinutes = undefined when HR is flat/rising (not measurably recovering)', () => {
    const exerciseEnd = 1000;
    const postExercise: HrSample[] = [
      { t: exerciseEnd + 60, bpm: 160 },
      { t: exerciseEnd + 120, bpm: 165 }, // rising, not recovering
    ];
    const result = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55 });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.estimatedRecoveryMinutes).toBeUndefined();
    expect(result.value.recoverySlopeBpmPerMin).toBeGreaterThanOrEqual(0);
  });

  it('respects a custom sampleToleranceSeconds', () => {
    const exerciseEnd = 1000;
    const postExercise: HrSample[] = [{ t: exerciseEnd + 90, bpm: 140 }]; // 30s off the 1-minute mark
    const tight = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55, sampleToleranceSeconds: 10 });
    expect(tight.kind).toBe('insufficient-data');

    const loose = computeHrr({ postExercise, exerciseEnd, hrAtEnd: 160, hrRest: 55, sampleToleranceSeconds: 30 });
    expect(loose.kind).toBe('ok');
  });
});
