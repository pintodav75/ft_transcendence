import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { EM_DASH } from '@/lib/utils';

import type { components, paths } from '@/lib/api-types.gen';

export type TeamDetail = components['schemas']['TeamDetail'];
export type TeamMember = components['schemas']['TeamMember'];
export type TeamInvitation = components['schemas']['TeamInvitation'];

type TeamDetailResponse =
  paths['/teams/{id}']['get']['responses'][200]['content']['application/json'];
type TeamMatchesResponse =
  paths['/teams/{id}/matches']['get']['responses'][200]['content']['application/json'];

export type TeamMatch = TeamMatchesResponse['matches'][number];
export type MatchLineup = NonNullable<TeamMatch['lineup']>;
export type LineupPlayer = MatchLineup['self'][number];

// The backend refuses an eleventh slot (`used >= 10` -> 409 `roster_full`). It is a
// flat cap, NOT derived from the format: a 2v2 team may bench extra players, so the
// format only sizes a lineup. Since B-INV a PENDING INVITATION holds a slot too — see
// `rosterUsage` below.
export const ROSTER_LIMIT = 10;

// Mirrors the backend param schema (`z.uuid()` in routes/teams.ts): an id that cannot
// be a uuid can only ever come back as a 400, so the page renders its error state
// without spending a request — and without a red line in the console.
const teamIdSchema = z.uuid();

export function isValidTeamId(teamId: string) {
  return teamIdSchema.safeParse(teamId).success;
}

export function useTeam(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: () => apiFetch<TeamDetailResponse>(`/teams/${teamId}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

export function useTeamMatches(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['team', teamId, 'matches'],
    queryFn: () => apiFetch<TeamMatchesResponse>(`/teams/${teamId}/matches`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// ---------------------------------------------------------------- derivations

/**
 * How many of the 10 roster slots are taken.
 *
 * The cap counts the SUM of members and pending invitations: the backend checks
 * `members + pending >= 10` when the captain invites, and a decline or a cancellation
 * gives the slot back. A counter showing members only would say "4/10" while the server
 * answers 409 `roster_full` — the screen would be contradicting the rule it displays.
 *
 * ⚠️ NO ROLE GUARD HERE, and none anywhere else on `invitations`. `GET /teams/{id}` OMITS
 * the key for a non-member (absent, not empty — same progressive disclosure as `lineup` on
 * the match history), so `data?.invitations ?? []` already yields `[]` for a visitor.
 * Re-deriving "may I see this?" client-side would be a second source of truth, and the two
 * would drift the day the backend changes its mind.
 */
export function rosterUsage(members: TeamMember[], invitations: TeamInvitation[]) {
  const pending = invitations.length;
  const used = members.length + pending;

  return { used, pending, full: used >= ROSTER_LIMIT };
}

export type FormResult = 'win' | 'loss' | 'dispute';

/**
 * Last results, most recent first — the history is already sorted by `scheduledAt`
 * DESC. Matches without an outcome (open slot, in progress) are skipped; a match an
 * admin still has to settle counts as an unknown, not as a loss.
 */
export function recentForm(matches: TeamMatch[], limit = 5) {
  const form: { id: string; result: FormResult }[] = [];

  for (const match of matches) {
    if (match.disputeStatus === 'open') form.push({ id: match.id, result: 'dispute' });
    else if (match.result) form.push({ id: match.id, result: match.result });

    if (form.length === limit) break;
  }

  return form;
}

/**
 * The soonest slot still waiting for an opponent. Members only in practice: the
 * backend strips opponent-less matches from a non-member's history.
 */
export function nextOpenSlot(matches: TeamMatch[]) {
  return matches
    .filter((match) => match.status === 'pending' && match.opponent === null)
    // The history arrives DESC, so plain array order would surface the LATEST slot.
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .at(0);
}

export function openDisputeCount(matches: TeamMatch[]) {
  return matches.filter((match) => match.disputeStatus === 'open').length;
}

// ------------------------------------------------------- match slots (FT-2C)

/**
 * Mirrors of `backend/src/routes/matches.ts`. They are duplicated here ON PURPOSE — the
 * point of FT-2C is to PRE-EMPT the server's refusals in the UI, which is impossible
 * without knowing the same numbers. The server stays the authority: every rule below is
 * re-checked there, under a lock.
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
 * 20:44:40 a naive list still offers 21:00 (15.3 min away), the captain thinks for forty
 * seconds, and the POST is refused. Five extra minutes cost one quarter and remove the
 * whole class of bug. The 400 is still mapped — see `isExpiredSlotError`.
 */
export const SLOT_LEAD_MARGIN_MINUTES = 20;
/** How far ahead a slot can be opened, in days. */
export const SLOT_HORIZON_DAYS = 7;

const MINUTE_MS = 60_000;

/**
 * The statuses that ENGAGE a side (`ENGAGING_STATUSES` backend-side). `completed` and
 * `cancelled` engage nobody any more, which is why a cancelled slot frees its window.
 */
const ENGAGING_STATUSES = new Set(['pending', 'in_progress', 'awaiting_confirmation', 'disputed']);

/** A slot the captain may still withdraw: opened by us, nobody has accepted it. */
export function isCancellableSlot(match: TeamMatch) {
  return match.status === 'pending' && match.opponent === null;
}

/**
 * Epoch times of the matches that currently engage this team.
 *
 * ⚠️ An expired `pending` slot (less than MIN_LEAD_MINUTES from its own time) is SKIPPED:
 * nobody can accept it any more, so the server stops counting it against its creator
 * (`or(ne(status,'pending'), gte(scheduledAt, stillAcceptable))`). Keeping it here would
 * grey out quarters the server would happily accept.
 */
export function engagementTimes(matches: TeamMatch[], nowMs: number) {
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
export function openSlotCount(matches: TeamMatch[], nowMs: number) {
  const stillAcceptable = nowMs + MIN_LEAD_MINUTES * MINUTE_MS;

  return matches.filter(
    (match) =>
      match.status === 'pending' &&
      match.scheduledAt !== null &&
      new Date(match.scheduledAt).getTime() >= stillAcceptable,
  ).length;
}

/**
 * Would opening a slot at `slotMs` overlap a match this team is already engaged in?
 *
 * ⚠️ STRICT inequality (`<`, never `<=`) — the mirror of `hasConflictingMatch`, which uses
 * `gt`/`lt`. Two matches that TOUCH do not overlap: on a 60-minute lockout, 21:00 and 22:00
 * are BOTH open, only 21:30 is refused. Turning this into `<=` would forbid playing two
 * matches back to back, which is the main thing a captain wants to do with this screen.
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

/** A lineup is ABSENT (not null) for a non-member: never assume the key is there. */
export function hasLineups(matches: TeamMatch[]) {
  return matches.some((match) => match.lineup !== undefined);
}

/** Nominative line-up of one side, members only (the key is absent for a visitor). */
export function formatLineup(players: LineupPlayer[]) {
  return players.map((player) => player.displayName ?? player.pseudo).join(' · ');
}

/**
 * `ladderName` is usually just "<game> <format>" ("Rocket League 2v2"), which the header
 * subtitle already spells out on its own — repeating it read "Rocket League · 2v2 ·
 * Rocket League 2v2". Some ladders DO carry more ("Counter-Strike 2 2v2 (Wingman)"), so
 * the name is kept whenever it says something the game and the format do not.
 */
export function ladderSubtitle(ladderName: string, gameName: string, format: string) {
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return squash(ladderName) === squash(`${gameName}${format}`) ? undefined : ladderName;
}

// ---------------------------------------------------------------- formatting

/**
 * ⚠️ `formatMatchDate` and `formatEloDelta` MOVED to `lib/match-detail.ts` (FT-4A, rule of
 * the second use): they format a MATCH, not a team, and the match sheet is their second
 * reader. Import them from there — there is deliberately no re-export shim here, which
 * would hide the move from the next reader.
 *
 * `formatScore` stayed: its input is the team history's own `{ self, opponent }` pair, a
 * shape that only `GET /teams/{id}/matches` produces.
 */

/** Bo3 score, or an em dash: `null` is possible even on a completed match. */
export function formatScore(score: TeamMatch['score']) {
  if (score.self === null || score.opponent === null) return EM_DASH;
  return `${score.self}–${score.opponent}`;
}
