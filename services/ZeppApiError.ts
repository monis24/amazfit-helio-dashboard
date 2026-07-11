/**
 * ZeppApiError.ts — typed error carrying enough context for retry/refresh
 * decisions, plus classifiers for both ZeppApiError (data-API calls) and
 * HuamiAuthError (the refresh call), so refreshAppToken's own HTTP call can
 * be retried the same way data calls are.
 *
 * `kind: 'missing-token'` exists because a missing app token is NOT a
 * transient condition — retrying the same request without a token wastes
 * every backoff attempt before ever reaching the refresh path (a bug an
 * earlier version of this file had: missing-token was misclassified as a
 * network error, so isRetryableZeppError said "retry" and isAuthError said
 * "not an auth problem," meaning refresh was never attempted at all).
 */

import { HuamiAuthError } from './HuamiAuth';

export type ZeppApiErrorKind = 'network' | 'http-status' | 'body-error' | 'missing-token';

export class ZeppApiError extends Error {
  readonly kind: ZeppApiErrorKind;
  readonly httpStatus: number | undefined;
  readonly bodyCode: number | undefined;

  constructor(
    message: string,
    kind: ZeppApiErrorKind,
    opts?: { httpStatus?: number; bodyCode?: number },
  ) {
    super(message);
    this.name = 'ZeppApiError';
    this.kind = kind;
    this.httpStatus = opts?.httpStatus;
    this.bodyCode = opts?.bodyCode;
    Object.setPrototypeOf(this, ZeppApiError.prototype);
  }
}

export function isRetryableZeppError(err: unknown): boolean {
  if (!(err instanceof ZeppApiError)) return true; // unknown/unexpected errors: be conservative, retry
  if (err.kind === 'missing-token') return false; // fail fast -- retrying without a token can't succeed
  if (err.httpStatus === undefined) return true; // network error, no response at all
  return err.httpStatus >= 500 || err.httpStatus === 429;
}

export function needsTokenRefresh(err: unknown): boolean {
  if (!(err instanceof ZeppApiError)) return false;
  if (err.kind === 'missing-token') return true;
  return err.httpStatus === 401 || err.httpStatus === 403;
}

/** Retry classifier for the refresh call itself (a HuamiAuthError, not a ZeppApiError). */
export function isRetryableHuamiAuthError(err: unknown): boolean {
  if (!(err instanceof HuamiAuthError)) return true; // unknown/unexpected: be conservative, retry
  if (err.httpStatus === undefined) return true; // network error
  return err.httpStatus >= 500 || err.httpStatus === 429;
}
