/**
 * humanizeReason.ts — strips the `kebab-case-identifier: ` prefix some
 * EngineResult/HookState 'insufficient-data' reasons carry (e.g.
 * `engines/BiometricEngine.ts`'s `'no-speed-data: workout stream has no
 * samples...'`) before showing it to a user. Those prefixes exist so a
 * developer reading logs/tests can tell failure modes apart at a glance
 * (SPEC.md never asked for them to be user-facing copy) — most reasons
 * across /engines and /hooks are already plain English and pass through
 * unchanged; this only touches the handful with a leading identifier.
 */
export function humanizeReason(reason: string): string {
  const match = /^[a-z0-9]+(?:-[a-z0-9]+)*:\s*(.+)$/.exec(reason);
  const text = match?.[1] ?? reason;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
