/**
 * The rules that decide WHICH SLOT MAY BE OPENED — mirrors of `backend/src/routes/matches.ts`.
 *
 * ⚠️ Written by FT-2C inside `lib/team-detail.ts`, because a captain opening a slot for his
 * team was their only reader. [F-SOLO] is the second one: a 1v1 ladder opens slots with the
 * very same grid, the very same 15-minute bound and the very same cap of five — and a solo
 * page importing "team-detail" would say the opposite of what the code does. So they MOVED
 * here (rule of two). **No logic was rewritten**, only the file they live in and the shape of
 * their inputs, which is now STRUCTURAL: `GET /teams/{id}/matches` and `GET /matches/me` do
 * not serve the same row, but both carry the two fields these rules actually read.
 *
 * 🚨 THIS MODULE IS THE REASON THE SOLO PANEL IS NOT A COPY OF `CreateMatchPanel`. The JSX of
 * the two forms legitimately differs (solo has no line-up), but the RULES must never drift:
 * the whole point of pre-empting the server here is that the screen never offers a slot the
 * API would refuse — a 4xx leaves a red line in the Chrome console, which is a
 * project-rejection criterion. Duplicate the numbers and that guarantee dies silently.
 *
 * The server stays the authority: every rule below is re-checked there, under a lock.
 */

/** Anti-spam cap: a side may not hold more than this many still-valid open slots. */
export const MAX_OPEN_SLOTS = 5;
/** A slot must be at least this far ahead — to create it AND to accept it. */
export const MIN_LEAD_MINUTES = 15;
/** Slots only ever fall on a fixed quarter: :00, :15, :30, :45. */
export const SLOT_GRID_MINUTES = 15;
/**
 * Extra margin on top of MIN_LEAD_MINUTES for the quarters we OFFER.
 *
 * The 15-minute bound is evaluated when the request LANDS, not when the list is drawn: at
 * 20:44:40 a naive list still offers 21:00 (15.3 min away), the user thinks for forty
 * seconds, and the POST is refused. Five extra minutes cost one quarter and remove the
 * whole class of bug. The 400 is still mapped — see `isExpiredSlotError`.
 */
export const SLOT_LEAD_MARGIN_MINUTES = 20;
/** How far ahead a slot can be opened, in days. */
export const SLOT_HORIZON_DAYS = 7;

const MINUTE_MS = 60_000;

/**
 * The strict minimum these rules read from a history row, described structurally rather
 * than by one API type — the two routes that feed them serve different shapes.
 *
 * ⚠️ `scheduledAt` is an ISO **string** that can be null, never a `Date` (invariant #8), and
 * `new Date(null)` silently yields 1970 instead of failing.
 */
export type SchedulableMatch = {
  status: string;
  scheduledAt: string | null;
};

/**
 * The statuses that ENGAGE a side (`ENGAGING_STATUSES` backend-side). `completed` and
 * `cancelled` engage nobody any more, which is why a cancelled slot frees its window.
 */
const ENGAGING_STATUSES = new Set(['pending', 'in_progress', 'awaiting_confirmation', 'disputed']);

/**
 * Epoch times of the matches that currently engage this side.
 *
 * ⚠️ An expired `pending` slot (less than MIN_LEAD_MINUTES from its own time) is SKIPPED:
 * nobody can accept it any more, so the server stops counting it against its creator
 * (`or(ne(status,'pending'), gte(scheduledAt, stillAcceptable))`). Keeping it here would
 * grey out quarters the server would happily accept.
 */
export function engagementTimes(matches: SchedulableMatch[], nowMs: number) {
  const stillAcceptable = nowMs + MIN_LEAD_MINUTES * MINUTE_MS;
  const times: number[] = [];

  for (const match of matches) {
    if (!ENGAGING_STATUSES.has(match.status)) continue;
    // `scheduledAt` is an ISO STRING that can be null — never a Date.
    if (!match.scheduledAt) continue;

    const at = new Date(match.scheduledAt).getTime();
    if (Number.isNaN(at)) continue;
    if (match.status === 'pending' && at < stillAcceptable) continue;

    times.push(at);
  }

  return times;
}

/**
 * Still-valid open slots, exactly as `countOpenSlots` counts them: `pending` AND at least
 * MIN_LEAD_MINUTES ahead. A dead slot does not eat one of the five.
 *
 * ⚠️ THE SCOPE IS THE SIDE, AND THE SIDE DIFFERS PER FORMAT — this function only counts what
 * it is handed, so the CALLER owns that decision. Backend-side (`countOpenSlots`), a 2v2+
 * side is the TEAM (which belongs to a single ladder, so no ladder filter is needed) while a
 * 1v1 side is the couple (PLAYER, LADDER). That is why the solo page passes
 * `GET /matches/me?ladderId=` and not the unfiltered list: handing it every ladder's matches
 * would count a chess slot against a Rocket League cap, and grey out a quarter the server
 * would accept.
 */
export function openSlotCount(matches: SchedulableMatch[], nowMs: number) {
  const stillAcceptable = nowMs + MIN_LEAD_MINUTES * MINUTE_MS;

  return matches.filter(
    (match) =>
      match.status === 'pending' &&
      match.scheduledAt !== null &&
      new Date(match.scheduledAt).getTime() >= stillAcceptable,
  ).length;
}

/**
 * Would opening a slot at `slotMs` overlap a match this side is already engaged in?
 *
 * ⚠️ STRICT inequality (`<`, never `<=`) — the mirror of `hasConflictingMatch`, which uses
 * `gt`/`lt`. Two matches that TOUCH do not overlap: on a 60-minute lockout, 21:00 and 22:00
 * are BOTH open, only 21:30 is refused. Turning this into `<=` would forbid playing two
 * matches back to back, which is the main thing a user wants to do with this screen.
 */
export function conflictsWithEngagement(
  slotMs: number,
  engagements: number[],
  lockoutMinutes: number,
) {
  const lockoutMs = lockoutMinutes * MINUTE_MS;
  return engagements.some((at) => Math.abs(slotMs - at) < lockoutMs);
}

export type SlotDay = {
  /** Local midnight as epoch milliseconds, stringified — a `<select>` value is a string. */
  value: string;
  label: string;
  startMs: number;
};

export type SlotTime = {
  /** The exact instant, as epoch milliseconds. `new Date(Number(value))` rebuilds it. */
  value: string;
  label: string;
  atMs: number;
};

const slotDayFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

const slotTimeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** The next `days` local days, starting today. */
export function slotDays(nowMs: number, days = SLOT_HORIZON_DAYS): SlotDay[] {
  const today = new Date(nowMs);
  const list: SlotDay[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    // Through the Date constructor, NOT by adding 86 400 000 ms: a DST change would
    // otherwise shift every following day by an hour.
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 0, 0, 0, 0);
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : slotDayFormat.format(start);

    list.push({ value: String(start.getTime()), label, startMs: start.getTime() });
  }

  return list;
}

/**
 * The quarters of one local day that are still far enough ahead to be opened.
 *
 * Built from the day's Y/M/D and a growing minute count so the instants are real LOCAL
 * quarters; every UTC offset in the world is a multiple of 15 minutes, so a local quarter
 * is always a UTC quarter — which is what `getUTCMinutes() % 15` checks server-side.
 */
export function slotTimes(
  dayStartMs: number,
  nowMs: number,
  marginMinutes = SLOT_LEAD_MARGIN_MINUTES,
): SlotTime[] {
  const earliest = nowMs + marginMinutes * MINUTE_MS;
  const day = new Date(dayStartMs);
  if (Number.isNaN(day.getTime())) return [];

  const list: SlotTime[] = [];
  // On a spring-forward day 02:00 does not exist and JS folds it onto 03:00, which would
  // hand React two children with the SAME key — a console warning, i.e. a rejection
  // criterion. Deduplicating on the instant costs nothing and closes the case.
  const seen = new Set<number>();

  for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_GRID_MINUTES) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, 0, 0);
    const atMs = at.getTime();

    if (atMs < earliest || seen.has(atMs)) continue;
    seen.add(atMs);

    list.push({ value: String(atMs), label: slotTimeFormat.format(at), atMs });
  }

  return list;
}
