/**
 * stressBands.test.ts — regression coverage for the fractional-average gap
 * found by the Before-Phase-4 checkpoint: StressChart buckets integer scores
 * into fractional averages, and values between two integer band boundaries
 * (e.g. 39.5) used to miss every band and fall through to the 'high'
 * fallback color.
 */

import { stressBandFor } from '../stressBands';

describe('stressBandFor', () => {
  it('maps integer scores to the Zepp bands', () => {
    expect(stressBandFor(0).band).toBe('relaxed');
    expect(stressBandFor(39).band).toBe('relaxed');
    expect(stressBandFor(40).band).toBe('normal');
    expect(stressBandFor(59).band).toBe('normal');
    expect(stressBandFor(60).band).toBe('medium');
    expect(stressBandFor(79).band).toBe('medium');
    expect(stressBandFor(80).band).toBe('high');
    expect(stressBandFor(100).band).toBe('high');
  });

  it('does not let fractional bucket averages between band boundaries fall through to high', () => {
    // 39.5 rounds to 40 (normal); 39.4 rounds to 39 (relaxed) — either way,
    // an adjacent band, never 'high'.
    expect(stressBandFor(39.5).band).toBe('normal');
    expect(stressBandFor(39.4).band).toBe('relaxed');
    expect(stressBandFor(59.5).band).toBe('medium');
    expect(stressBandFor(59.2).band).toBe('normal');
    expect(stressBandFor(79.7).band).toBe('high');
    expect(stressBandFor(79.3).band).toBe('medium');
  });

  it('covers every fractional value in [0, 100] with a non-fallback band', () => {
    for (let v = 0; v <= 100; v += 0.1) {
      const band = stressBandFor(v);
      const rounded = Math.round(v);
      expect(rounded >= band.min && rounded <= band.max).toBe(true);
    }
  });

  it('clamps out-of-scale values above 100 to the top band', () => {
    expect(stressBandFor(101).band).toBe('high');
    expect(stressBandFor(250).band).toBe('high');
  });
});
