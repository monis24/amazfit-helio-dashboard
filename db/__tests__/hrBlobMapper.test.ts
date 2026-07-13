import { mapHrDayToSamples, mapHrDaysToSamplesInRange, type HrDayForMapping } from '../mappers/hrBlobMapper';
import { hrBlobAnchorUtc } from '../mappers/dayAnchor';

const TZ = -25200; // UTC-7, matches the live-verified account in dayAnchor.ts's doc comment

describe('mapHrDayToSamples', () => {
  it('maps a full day, anchoring to date_time\'s own midnight (hrBlobAnchorUtc, not segmentAnchorUtc)', () => {
    const localDate = '2026-07-08';
    const anchor = hrBlobAnchorUtc(localDate, TZ);
    const hrMinutes = new Uint8Array(1440).fill(70);
    hrMinutes[0] = 63;
    hrMinutes[1439] = 88;

    const samples = mapHrDayToSamples({ localDate, tzOffsetSec: TZ, hrMinutes });
    expect(samples).toHaveLength(1440);
    expect(samples[0]).toEqual({ t: anchor, bpm: 63 });
    expect(samples[1439]).toEqual({ t: anchor + 1439 * 60, bpm: 88 });
  });

  it('drops the 254 sentinel and any other implausible bpm byte', () => {
    const hrMinutes = new Uint8Array(4);
    hrMinutes[0] = 70;
    hrMinutes[1] = 254; // documented sentinel
    hrMinutes[2] = 0; // not a plausible bpm either
    hrMinutes[3] = 255;

    const samples = mapHrDayToSamples({ localDate: '2026-07-08', tzOffsetSec: TZ, hrMinutes });
    expect(samples).toHaveLength(1);
    expect(samples[0]?.bpm).toBe(70);
  });
});

describe('mapHrDaysToSamplesInRange', () => {
  it('splices two consecutive days and filters to the requested UTC window', () => {
    const day1 = '2026-07-07';
    const day2 = '2026-07-08';
    const rows: HrDayForMapping[] = [
      { localDate: day1, tzOffsetSec: TZ, hrMinutes: new Uint8Array(1440).fill(60) },
      { localDate: day2, tzOffsetSec: TZ, hrMinutes: new Uint8Array(1440).fill(90) },
    ];

    const anchor2 = hrBlobAnchorUtc(day2, TZ);
    // Window spans the last hour of day1 into the first hour of day2.
    const fromUtc = anchor2 - 3600;
    const toUtc = anchor2 + 3600;

    const samples = mapHrDaysToSamplesInRange(rows, fromUtc, toUtc);
    expect(samples.length).toBe(120); // 60 minutes from each day
    expect(samples[0]?.bpm).toBe(60);
    expect(samples[samples.length - 1]?.bpm).toBe(90);
    // Sorted chronologically across the splice boundary.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.t).toBeGreaterThan(samples[i - 1]!.t);
    }
  });
});
