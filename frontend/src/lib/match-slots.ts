/**
 * Rules deciding which slot may be opened. Mirror of backend/src/routes/matches.ts:
 * quarter-hour grid, 15 min minimum lead, 5 open slots max.
 *
 * shared by the team panel and the solo panel, so the two can't drift. inputs are structural:
 * GET /teams/{id}/matches and GET /matches/me don't serve the same row, but both carry the
 * two fields these rules read.
 * don't recopy the numbers into a form — if the screen offers a slot the API refuses you get
 * a 4xx, and a red console line is a rejection motive.
 * server re-checks all of it under a lock.
 */

/** Anti-spam cap: a side may not hold more than this many still-valid open slots. */
export const MAX_OPEN_SLOTS = 5;
/** A slot must be at least this far ahead — to create it AND to accept it. */
export const MIN_LEAD_MINUTES = 15;
/** Slots only ever fall on a fixed quarter: :00, :15, :30, :45. */
export const SLOT_GRID_MINUTES = 15;
/** Extra margin on top of MIN_LEAD_MINUTES for the quarters we OFFER. */
export const SLOT_LEAD_MARGIN_MINUTES = 20;
/** How far ahead a slot can be opened, in days. */
export const SLOT_HORIZON_DAYS = 7;

const MINUTE_MS = 60_000;

/**
 * The strict minimum these rules read from a history row, described structurally rather than by
 * one API type — the two routes that feed them serve different shapes.
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

/** Epoch times of the matches that currently engage this side. */
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

/** Would opening a slot at `slotMs` overlap a match this side is already engaged in? */
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

/** `en-GB`, ET PAS `en-US`. */
const slotDayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

const slotTimeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The next `days` local days, starting today. */
export function slotDays(nowMs: number, days = SLOT_HORIZON_DAYS): SlotDay[] {
  const today = new Date(nowMs);
  const list: SlotDay[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    // Through the Date constructor, NOT by adding 86 400 000 ms: a DST change would otherwise
    // shift every following day by an hour.
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 0, 0, 0, 0);
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : slotDayFormat.format(start);

    list.push({ value: String(start.getTime()), label, startMs: start.getTime() });
  }

  return list;
}

/** The quarters of one local day that are still far enough ahead to be opened. */
export function slotTimes(
  dayStartMs: number,
  nowMs: number,
  marginMinutes = SLOT_LEAD_MARGIN_MINUTES,
): SlotTime[] {
  const earliest = nowMs + marginMinutes * MINUTE_MS;
  const day = new Date(dayStartMs);
  if (Number.isNaN(day.getTime())) return [];

  const list: SlotTime[] = [];
  // On a spring-forward day 02:00 does not exist and JS folds it onto 03:00, which would hand
  // React two children with the SAME key — a console warning, i.e.
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
