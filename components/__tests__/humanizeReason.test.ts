import { humanizeReason } from '../humanizeReason';

describe('humanizeReason', () => {
  it('strips a leading kebab-case identifier prefix and capitalizes the remainder', () => {
    expect(humanizeReason('no-speed-data: workout stream has no samples with both HR and speed present')).toBe(
      'Workout stream has no samples with both HR and speed present',
    );
  });

  it('leaves an already-plain-English reason unchanged apart from capitalization', () => {
    expect(humanizeReason('no sleep session recorded yet')).toBe('No sleep session recorded yet');
  });

  it('handles a reason with no colon at all', () => {
    expect(humanizeReason('invalid hrMax 0')).toBe('Invalid hrMax 0');
  });

  it('strips a multi-word hyphenated identifier prefix', () => {
    expect(
      humanizeReason(
        'workout-stream-decoding-unimplemented: workout_details wire shape is unverified (SPEC.md live blocker)',
      ),
    ).toBe('Workout_details wire shape is unverified (SPEC.md live blocker)');
  });
});
