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
