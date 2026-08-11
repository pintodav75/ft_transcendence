/**
 * The age of ONE ROW of the social rail, in the width the rail has to spare.
 *
 * Extracted from `lib/messages.ts` at its SECOND consumer: a notification row asks the
 * exact same question a conversation row does — "when was this?", answered in a column 312 px
 * wide — and the repo's rule is that the second real use extracts rather than copies. The
 * reasoning below moved here with the code.
 */

/** Local calendar day, so "same day" means what the reader's clock says, not what UTC says. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * `en-GB` is pinned, like every other formatter of the repo: a 24-hour clock, and the same
 * string on every machine (a host locale would make the console audit compare against a moving
 * target).
 */
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
/** Same date without the year — a rail row has one line and a 312 px column to fit in. */
const shortDayFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

/** `14:32`. The whole of what a chat bubble shows, and the "today" branch of the rail below. */
export function formatClockTime(date: Date) {
  return clockFormat.format(date);
}

/** `28 Jul 2026` — the unambiguous form, used once a date is neither today nor yesterday. */
export function formatFullDate(date: Date) {
  return dayFormat.format(date);
}

/** `14:32` / `Yesterday` / `28 Jul` / `28 Jul 2025`. */
export function formatRailTime(isoDate: string) {
  const date = new Date(isoDate);
  const today = new Date();

  if (dayKey(date) === dayKey(today)) return formatClockTime(date);

  const yesterday = new Date(today);
  // `setDate` with 0 or -1 rolls back into the previous month (and year) on its own.
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';

  return date.getFullYear() === today.getFullYear()
    ? shortDayFormat.format(date)
    : formatFullDate(date);
}
