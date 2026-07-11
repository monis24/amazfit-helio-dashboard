import { withRetry } from '../retry';

function fakeSleep(calls: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    calls.push(ms);
  };
}

describe('withRetry', () => {
  it('returns the result on first success without sleeping', async () => {
    const sleeps: number[] = [];
    const result = await withRetry(async () => 'ok', {
      maxAttempts: 3,
      baseDelayMs: 100,
      isRetryable: () => true,
      sleep: fakeSleep(sleeps),
    });
    expect(result).toBe('ok');
    expect(sleeps).toHaveLength(0);
  });

  it('retries retryable failures up to maxAttempts, then throws', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('boom');
        },
        { maxAttempts: 3, baseDelayMs: 100, isRetryable: () => true, sleep: fakeSleep(sleeps) },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2); // slept between attempts 1->2 and 2->3, not after the last
  });

  it('succeeds after transient failures within maxAttempts', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return 'recovered';
      },
      { maxAttempts: 5, baseDelayMs: 10, isRetryable: () => true, sleep: fakeSleep([]) },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('permanent');
        },
        { maxAttempts: 5, baseDelayMs: 10, isRetryable: () => false, sleep: fakeSleep([]) },
      ),
    ).rejects.toThrow('permanent');
    expect(calls).toBe(1);
  });

  it('backs off exponentially with each attempt', async () => {
    const sleeps: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new Error('boom');
        },
        { maxAttempts: 4, baseDelayMs: 100, isRetryable: () => true, sleep: fakeSleep(sleeps) },
      ),
    ).rejects.toThrow();
    expect(sleeps).toHaveLength(3);
    // Each delay should be roughly double the previous (within the +/-10% jitter band).
    expect(sleeps[1]! / sleeps[0]!).toBeGreaterThan(1.6);
    expect(sleeps[2]! / sleeps[1]!).toBeGreaterThan(1.6);
  });
});
