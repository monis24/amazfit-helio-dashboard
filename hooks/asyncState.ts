/**
 * asyncState.ts — shared "DB read in flight" wrapper for /hooks. Distinct
 * from /engines' EngineResult: EngineResult is a pure function's fallible
 * *computation* outcome (sync, no loading state); HookState wraps the
 * async DB round-trip a hook needs before it can even call an engine.
 * useInsights() nests EngineResult values inside HookState's 'ready' case.
 */

export type HookState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

export const LOADING: HookState<never> = { status: 'loading' };

export function errorState(err: unknown): HookState<never> {
  return { status: 'error', message: err instanceof Error ? err.message : String(err) };
}
