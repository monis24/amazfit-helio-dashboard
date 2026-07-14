/**
 * chartTimeFormat.ts — formats an x-axis tick's raw epoch-seconds value as a
 * local clock time. Victory Native's default tick label is the raw numeric
 * value (unix seconds) — fine for MaybeNumber-typed X axes in general, but
 * unreadable for every time-series chart in this app once axis labels
 * actually render (see useChartFont.ts's doc comment for why they didn't
 * before).
 */
export function formatHourLabel(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric' });
}

export function formatClockLabel(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
