/**
 * retry.ts — generic exponential-backoff retry helper (SPEC.md Phase 1:
 * "retry with exponential backoff on all network failures"). `sleep` is
 * injectable so tests can run backoff logic without real timers.
 */

export interface RetryOptions {
  /** Total attempts including the first (non-retry) one. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly isRetryable: (error: unknown) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= opts.maxAttempts || !opts.isRetryable(err)) throw err;
      // Exponential backoff with jitter: base * 2^(attempt-1), +/-10% jitter.
      const delay = opts.baseDelayMs * 2 ** (attempt - 1) * (0.9 + Math.random() * 0.2);
      await sleep(delay);
    }
  }
}
