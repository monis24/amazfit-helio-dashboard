/**
 * localDateRange.ts — turns a UTC epoch-seconds instant into a padded
 * local_date range for querying hr_days/stress_days. Deliberately
 * approximate: local_date is a calendar-date string keyed by each record's
 * OWN tz_offset_sec (db/schema.ts), which isn't known until after the query
 * returns, so there's no way to compute the exact local date up front. Padding
 * by a day on each side over-fetches by at most one cheap extra row per
 * side — safe, unlike under-fetching and silently dropping real data near a
 * boundary.
 */

const ONE_DAY_SECONDS = 86400;

function isoDateUtc(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function paddedLocalDateRange(fromUtc: number, toUtc: number): { readonly from: string; readonly to: string } {
  return {
    from: isoDateUtc(fromUtc - ONE_DAY_SECONDS),
    to: isoDateUtc(toUtc + ONE_DAY_SECONDS),
  };
}

/**
 * Today's calendar date as the device itself sees it right now — deliberately
 * NOT `new Date().toISOString().slice(0, 10)` (UTC), which is wrong for
 * roughly a third of every day in negative-offset timezones (US, etc.): once
 * UTC has crossed midnight but the device's own local midnight hasn't yet,
 * that gives tomorrow's date, not today's. This is the same trap
 * db/queries/events.ts's localDateFromEpochMs doc comment already flags for
 * historical event timestamps — this is the live version of it, for "what
 * day is it right now." Unlike paddedLocalDateRange's chicken-and-egg
 * problem (the ACCOUNT's tz_offset_sec isn't known until a row comes back),
 * there's no such problem here: the device always knows its own current
 * local date immediately, via plain Date getters, no query needed.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr: string): { readonly year: number; readonly month: number; readonly day: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year: year as number, month: month as number, day: day as number };
}

/**
 * The UTC epoch-seconds window spanning one full local calendar day (local
 * midnight to the next local midnight, device-local timezone) — the
 * detail-screen equivalent of todayLocalDate's "what day is it" for "give
 * me this whole day's data," for an arbitrary (not necessarily today) date.
 */
export function localDayWindow(dateStr: string): { readonly fromUtc: number; readonly toUtc: number } {
  const { year, month, day } = parseLocalDate(dateStr);
  const fromUtc = new Date(year, month - 1, day, 0, 0, 0).getTime() / 1000;
  const toUtc = new Date(year, month - 1, day + 1, 0, 0, 0).getTime() / 1000;
  return { fromUtc, toUtc };
}

/** Shifts a YYYY-MM-DD local-date string by `deltaDays` — used for
 *  swipe-to-previous/next-day paging on the metric detail screen. Goes
 *  through Date's local constructor/getters (not string math) so month/year
 *  rollovers and DST are handled correctly. */
export function shiftLocalDate(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseLocalDate(dateStr);
  return todayLocalDate(new Date(year, month - 1, day + deltaDays));
}
