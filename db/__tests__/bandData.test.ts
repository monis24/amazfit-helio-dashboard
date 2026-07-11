import { openNodeSqliteDatabase } from '../adapters/NodeSqliteAdapter';
import { runMigrations } from '../schema';
import { upsertHrDay, upsertSleepSummary, upsertActivitySummary } from '../queries/bandData';
import { segmentAnchorUtc } from '../mappers/dayAnchor';
import type { SqliteDatabase } from '../Database';
import type { BandDataRecord } from '../../types/ZeppApiSchemas';

const DATE_TIME = '2026-07-07';
const TZ = '-25200';
// The real anchor for DATE_TIME/TZ (verified against live Phase 0 data:
// midnight of the day BEFORE date_time, not date_time's own midnight).
const ANCHOR = segmentAnchorUtc(DATE_TIME, Number(TZ));

function jsonToBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}

function bytesToBase64(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('base64');
}

function buildSummary(overrides: { stage?: { start: number; stop: number; mode: 4 | 5 | 7 | 8 }[] } = {}) {
  const stage = overrides.stage ?? [
    { start: 0, stop: 59, mode: 4 as const },
    { start: 60, stop: 119, mode: 5 as const },
  ];
  const totals: Record<number, number> = { 4: 0, 5: 0, 7: 0, 8: 0 };
  for (const seg of stage) totals[seg.mode] = (totals[seg.mode] ?? 0) + (seg.stop - seg.start + 1);
  const first = stage[0]!;
  const last = stage[stage.length - 1]!;
  const st = ANCHOR + first.start * 60;
  const ed = ANCHOR + (last.stop + 1) * 60;

  return {
    goal: 8000,
    algv: 'v',
    isMerged: 0,
    stp: {
      runCal: 1,
      cal: 173,
      conAct: 0,
      ncal: 0,
      ttl: 4500,
      dis: 3365,
      rn: 51,
      wk: 18,
      stage: [{ start: 10, stop: 20, mode: 3 as const, dis: 100, step: 200, cal: 5 }],
      runDist: 2591,
    },
    tz: TZ,
    v: 6,
    sn: 'TEST',
    iOS: 'v',
    slp: {
      pe: 0,
      wk: totals[7],
      wc: 1,
      ed,
      ebt: 0,
      supNap: false,
      dp: totals[5],
      lb: 0,
      odd_stage: [],
      is: 2,
      stage,
      napSleepSource: 0,
      isMerged: 0,
      napAlgoVersion: 'v',
      supRem: true,
      lt: totals[4],
      rhr: 55,
      sleepScoreVersion: 'v',
      selected: 0,
      ps: 0,
      dt: totals[8],
      ss: 0,
      sleepAlgoVersion: 'v',
      st,
      sleepSource: 0,
    },
    hr: { maxHr: { hr: 150, ts: 1200 } },
    byteLength: 8,
    sync: 0,
  };
}

function buildRecord(overrides: Partial<BandDataRecord> = {}): BandDataRecord {
  return {
    uid: 'u1',
    data_type: 0,
    date_time: '2026-07-07',
    source: 111,
    summary: jsonToBase64(buildSummary()),
    device_id: 'dev1',
    uuid: 'uuid1',
    data: bytesToBase64([0, 0, 0]),
    data_hr: bytesToBase64(Array(1440).fill(70)),
    ...overrides,
  };
}

describe('bandData query layer', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('upsertHrDay stores the decoded 1440-byte blob and can be read back', async () => {
    await upsertHrDay(db, buildRecord());
    const row = await db.getFirstAsync<{ hr_minutes: Buffer; max_hr_bpm: number }>(
      'SELECT hr_minutes, max_hr_bpm FROM hr_days WHERE local_date = ? AND source = ?',
      ['2026-07-07', 111],
    );
    expect(row).not.toBeNull();
    expect(row!.hr_minutes.length).toBe(1440);
    expect(row!.max_hr_bpm).toBe(150);
  });

  it('upsertHrDay is last-write-wins on (local_date, source)', async () => {
    await upsertHrDay(db, buildRecord({ data_hr: bytesToBase64(Array(1440).fill(70)) }));
    await upsertHrDay(db, buildRecord({ data_hr: bytesToBase64(Array(1440).fill(88)) }));

    const rows = await db.getAllAsync('SELECT * FROM hr_days WHERE local_date = ? AND source = ?', [
      '2026-07-07',
      111,
    ]);
    expect(rows).toHaveLength(1); // upsert, not duplicate insert
    const row = await db.getFirstAsync<{ hr_minutes: Buffer }>(
      'SELECT hr_minutes FROM hr_days WHERE local_date = ? AND source = ?',
      ['2026-07-07', 111],
    );
    expect(row!.hr_minutes[0]).toBe(88); // second write wins
  });

  it('upsertSleepSummary persists a session and its segments with correct epoch anchoring', async () => {
    const result = await upsertSleepSummary(db, buildRecord());
    expect(result.kind).toBe('ok');

    const session = await db.getFirstAsync<{ start_utc: number; end_utc: number; light_min: number }>(
      'SELECT start_utc, end_utc, light_min FROM sleep_sessions WHERE local_date = ? AND source = ?',
      ['2026-07-07', 111],
    );
    expect(session).toEqual({ start_utc: ANCHOR, end_utc: ANCHOR + 120 * 60, light_min: 60 });

    const segments = await db.getAllAsync('SELECT * FROM sleep_stage_segments WHERE local_date = ? AND source = ?', [
      '2026-07-07',
      111,
    ]);
    expect(segments).toHaveLength(2);
  });

  it('upsertSleepSummary replaces segments wholesale on re-sync (delete-and-reinsert, no stale rows)', async () => {
    await upsertSleepSummary(
      db,
      buildRecord({
        summary: jsonToBase64(
          buildSummary({
            stage: [
              { start: 0, stop: 29, mode: 4 },
              { start: 30, stop: 59, mode: 5 },
              { start: 60, stop: 89, mode: 7 },
            ],
          }),
        ),
      }),
    );
    let segments = await db.getAllAsync('SELECT * FROM sleep_stage_segments WHERE local_date = ? AND source = ?', [
      '2026-07-07',
      111,
    ]);
    expect(segments).toHaveLength(3);

    // Device re-merges into a 2-segment session for the same date/source.
    await upsertSleepSummary(
      db,
      buildRecord({
        summary: jsonToBase64(buildSummary({ stage: [{ start: 0, stop: 119, mode: 4 }] })),
      }),
    );
    segments = await db.getAllAsync('SELECT * FROM sleep_stage_segments WHERE local_date = ? AND source = ?', [
      '2026-07-07',
      111,
    ]);
    expect(segments).toHaveLength(1); // old 3 segments gone, not accumulated to 4
  });

  it('upsertSleepSummary returns anchoring-mismatch (not no-sleep-data) rather than throwing on a corrupt payload', async () => {
    const badSummary = buildSummary();
    badSummary.slp.st += 999; // breaks the anchoring assertion
    const result = await upsertSleepSummary(db, buildRecord({ summary: jsonToBase64(badSummary) }));
    expect(result.kind).toBe('anchoring-mismatch');

    const session = await db.getFirstAsync('SELECT * FROM sleep_sessions WHERE local_date = ?', ['2026-07-07']);
    expect(session).toBeNull(); // nothing partially written
  });

  it('upsertSleepSummary returns no-sleep-data (not anchoring-mismatch) for a day with nothing recorded', async () => {
    const emptySummary = buildSummary();
    emptySummary.slp.stage = [];
    const result = await upsertSleepSummary(db, buildRecord({ summary: jsonToBase64(emptySummary) }));
    expect(result.kind).toBe('no-sleep-data');
  });

  it('upsertActivitySummary persists activity_days and step_segments', async () => {
    await upsertActivitySummary(db, buildRecord());
    const day = await db.getFirstAsync<{ total_steps: number; goal: number }>(
      'SELECT total_steps, goal FROM activity_days WHERE local_date = ? AND source = ?',
      ['2026-07-07', 111],
    );
    expect(day).toEqual({ total_steps: 4500, goal: 8000 });

    const segments = await db.getAllAsync('SELECT * FROM step_segments WHERE local_date = ? AND source = ?', [
      '2026-07-07',
      111,
    ]);
    expect(segments).toHaveLength(1);
  });
});
