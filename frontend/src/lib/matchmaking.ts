import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { MIN_LEAD_MINUTES } from '@/lib/match-slots';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of `/matchmaking` — the board of every open slot, and the verdict that says
 * whether I could take each one.
 *
 * 🚨 THE ANONYMITY IS THE FEATURE, NOT AN OVERSIGHT (decision B5b, restated by [B-MM]): the
 * payload carries neither the team that opened the slot nor the maps. You accept a slot
 * WITHOUT knowing who is on the other side — that is what stops people from picking their
 * opponents, and what protects the Elo. So a row says game, format, ladder and kick-off,
 * and there is nothing else to render: no name, no avatar, no Elo.
 *
 * 🔑 `canAccept` / `reason` is what makes this screen possible at all. The server replays the
 * exact guards of `POST /matches/{id}/accept` (§5.1 linked account, team, captaincy, roster,
 * §5.2 windows) and hands back a single code — the FIRST guard that falls. The screen offers
 * a button only where `canAccept` is true: a button the API would refuse writes a red line in
 * the Chrome console, and that is a project-rejection criterion, not a rough edge.
 */
type OpenSlotsResponse = paths['/matches']['get']['responses'][200]['content']['application/json'];

/** One open slot, anonymous by design. */
export type OpenSlot = OpenSlotsResponse['slots'][number];
/** Closed enum: `null` exactly when `canAccept` is true. */
export type SlotRefusalReason = NonNullable<OpenSlot['reason']>;
export type SlotFormat = OpenSlot['format'];

/**
 * The formats a slot can be played in, for the filter menu.
 *
 * `satisfies readonly SlotFormat[]` types the literal AGAINST the codegen union, so removing
 * a format from the contract breaks the build here instead of leaving a filter that silently
 * matches nothing. It is deliberately not derived from `GET /ladders`: a filter must keep
 * working when the reference data fails to load, and it is the API that owns the enum.
 */
export const SLOT_FORMATS = ['1v1', '2v2', '3v3', '5v5'] as const satisfies readonly SlotFormat[];

/**
 * How many slots we ask for, restated here rather than left to the server's default.
 *
 * ⚠️ `limit` is applied AFTER the acceptability filter and the route carries neither a cursor
 * nor a total, so a full list can be truncated IN SILENCE — mostly when the "only what I can
 * accept" box is unchecked. The screen must be able to say "you are seeing the first 50", and
 * comparing `slots.length` against a number we chose ourselves is the only honest way to know.
 */
export const OPEN_SLOTS_LIMIT = 50;

/** Number of players a side fields on this format — 1, 2, 3 or 5. */
export function lineupSize(format: SlotFormat) {
  return Number.parseInt(format, 10);
}

export type OpenSlotFilters = {
  /** From `?ladderId=` — already checked against the CACHED ladder list by the caller. */
  ladderId?: string;
  /** Game slug (`cs2`), never a uuid. */
  gameId?: string;
  format?: SlotFormat;
  /**
   * `true` → `?acceptable=true`. `false` → the parameter is OMITTED, so everything is listed.
   * ⚠️ Never `?acceptable=false`: that is the server's "why can I not play?" mode, which
   * would hide the very slots the user can take.
   */
  acceptableOnly: boolean;
};

/**
 * ⚠️ A PARAMETER IS OMITTED, NEVER SENT EMPTY. `?gameId=` is treated as absent since the
 * review of [B-MM], but building the URL from a blank filter is how a screen ends up sending
 * `?format=` and discovering the day the server stops forgiving it. A genuinely invalid value
 * (`?acceptable=1`) is a 400, and rightly so.
 */
function openSlotsSearch(filters: OpenSlotFilters) {
  const params = new URLSearchParams();
  if (filters.ladderId) params.set('ladderId', filters.ladderId);
  if (filters.gameId) params.set('gameId', filters.gameId);
  if (filters.format) params.set('format', filters.format);
  if (filters.acceptableOnly) params.set('acceptable', 'true');
  params.set('limit', String(OPEN_SLOTS_LIMIT));

  return params.toString();
}

/**
 * Prefix of every board entry, so a mutation can sweep them ALL without knowing which filters
 * are on screen — accepting a slot removes it from every combination at once.
 */
export const OPEN_SLOTS_ROOT_KEY = ['matches', 'open-slots'] as const;

export function openSlotsKey(filters: OpenSlotFilters) {
  return [...OPEN_SLOTS_ROOT_KEY, filters] as const;
}

/**
 * The board itself.
 *
 * ⚠️ NO `staleTime`, on purpose, where the reference data of this repo caches for an hour: a
 * slot dies 15 minutes before its own kick-off and any camp can take it at any instant. A
 * cached board is a board that offers a button the API would refuse — the one thing this
 * screen must never do. TanStack's default refetch on window focus is the point, not a
 * detail: the user leaves to check his schedule and comes back.
 */
export function useOpenSlots(filters: OpenSlotFilters, enabled = true) {
  return useQuery({
    queryKey: openSlotsKey(filters),
    queryFn: () => apiFetch<OpenSlotsResponse>(`/matches?${openSlotsSearch(filters)}`),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

// -------------------------------------------------------------- expiry (the 15-min bound)

const MINUTE_MS = 60 * 1000;
/** How often the board re-reads the wall clock. Half a minute of slack on a 15-minute rule. */
const CLOCK_TICK_MS = 30 * 1000;

/**
 * A clock that ADVANCES, so the board can retire a slot the server has not been asked about
 * again.
 *
 * 🚨 WHY A TICKING CLOCK AND NOT `dataUpdatedAt` ALONE. On the match sheet ([FT-4B]) the safe
 * direction was the past: a late `now` only ever HID the score form. Here it is the opposite —
 * a late `now` makes a slot look FURTHER AWAY than it is, so it would keep offering a button
 * the server now refuses. Worse, `dataUpdatedAt` used on its own is a strict no-op: it is the
 * very instant the server applied the same 15-minute rule, so it can never disagree with the
 * list it came with. The failing case is real and needs no race at all — a slot 16 minutes out,
 * two minutes spent reading the page, one click, **409 and a red line in the console**.
 *
 * ⚠️ `dataUpdatedAt` is still used, as a FLOOR (`Math.max` in the page): it is the last instant
 * the server certified, so a client clock running behind the server can never drag the board
 * back before it.
 */
export function useSlotClock(intervalMs = CLOCK_TICK_MS) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}

/**
 * Has this slot crossed the bound under which nobody can take it any more?
 *
 * `POST /matches/{id}/accept` answers **409** below `MIN_LEAD_MINUTES` of kick-off, and
 * `GET /matches` hides those rows — but only as of the instant it answered. This is the same
 * rule, re-applied on the client between two fetches.
 *
 * ⚠️ An unparsable date counts as EXPIRED. The contract says `scheduledAt` is never null here,
 * so this cannot happen; if it ever did, hiding a button is the only failure that costs
 * nothing, where showing one costs a console error.
 */
export function isSlotExpired(slot: OpenSlot, nowMs: number) {
  const at = Date.parse(slot.scheduledAt);
  if (!Number.isFinite(at)) return true;

  return at - nowMs < MIN_LEAD_MINUTES * MINUTE_MS;
}

/**
 * The row keeps its place and states the rule, exactly like a server-side refusal — the board
 * is never allowed to become a dead end, and a row that simply vanished would read as a bug.
 * There is no `reason` code for this one: the server never has to name it, because it filters
 * those slots out instead.
 */
export const EXPIRED_SLOT_REFUSAL: SlotRefusal = {
  text: `This slot kicks off in less than ${MIN_LEAD_MINUTES} minutes, so it can no longer be accepted. It leaves the board on the next refresh.`,
  action: null,
};

export function openSlotsErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Both are unreachable from this screen — the query string is built above and the ladder
    // is checked against the cached list before it is ever sent. Mapped anyway, because
    // "unreachable" is exactly what a stale tab makes reachable.
    if (error.status === 400) return 'This board could not be filtered. Reload the page.';
    if (error.status === 404) return 'That ladder does not exist any more.';
  }

  return 'The open slots could not be loaded. Check your connection and reload the page.';
}

// ------------------------------------------------------------------ refusals

/**
 * The way OUT of a refusal — every reason that has a remedy carries the link to it, which is
 * what keeps this board from being a dead end.
 *
 * `null` for the two that have none today: `account_not_linked` (there is no account-linking
 * screen yet — card [F4B]) and `schedule_conflict` (naming the clashing match would cost a
 * second request for every row, and the payload does not carry it).
 */
export type RefusalAction =
  | { kind: 'create-team'; ladderId: string; label: string }
  | { kind: 'open-team'; teamId: string; label: string }
  | null;

export type SlotRefusal = { text: string; action: RefusalAction };

type RefusalContext = {
  /**
   * My team on THIS slot's ladder, from the cached `GET /teams` — `undefined` while it loads
   * or if it failed. A missing id degrades the row to plain text; it never produces a link
   * pointing nowhere.
   */
  myTeamId: string | undefined;
  /** "Steam", "Riot"… — `undefined` when the game list has not resolved. */
  providerName: string | undefined;
};

/**
 * Turns the server's verdict into a sentence AND a remedy.
 *
 * ⚠️ `roster_too_small` and `roster_not_linked` stay SEPARATE, exactly as the contract keeps
 * them: "invite more players" and "ask your players to link their Steam" are two different
 * jobs, and merging them would send a captain looking for the wrong fix. That distinction is
 * the reason the backend runs a LEFT JOIN with two counters instead of one.
 *
 * The `switch` is exhaustive over the closed enum, so a seventh reason breaks the build here
 * rather than rendering an empty cell.
 */
export function slotRefusal(
  slot: OpenSlot,
  reason: SlotRefusalReason,
  { myTeamId, providerName }: RefusalContext,
): SlotRefusal {
  const size = lineupSize(slot.format);
  // The two roster reasons are only ever served to a CAPTAIN, so the id is known as soon as
  // `GET /teams` resolves. `not_captain` names a team I am merely a member of — also known.
  const team: RefusalAction = myTeamId
    ? { kind: 'open-team', teamId: myTeamId, label: 'Open my team' }
    : null;
  const account = providerName ? `${providerName} account` : 'game account';

  switch (reason) {
    case 'account_not_linked':
      return {
        text: `Playing ${slot.gameName} needs a linked ${account}, and yours is not linked yet.`,
        // No link on purpose: the screen that links an account does not exist yet ([F4B]).
        // A button leading nowhere is worse than a sentence that stops.
        action: null,
      };

    case 'no_team':
      return {
        text: `You have no team on ${slot.ladderName} — this ladder is played in ${slot.format}.`,
        action: { kind: 'create-team', ladderId: slot.ladderId, label: 'Create a team' },
      };

    case 'not_captain':
      return {
        text: 'Only the captain of your team can commit it to a match.',
        action: team,
      };

    case 'roster_too_small':
      return {
        text: `Your team needs ${size} players to field a line-up here.`,
        action: team ? { ...team, label: 'Recruit players' } : null,
      };

    case 'roster_not_linked':
      return {
        text: `Fewer than ${size} of your players have linked their ${account}.`,
        action: team ? { ...team, label: 'See the roster' } : null,
      };

    case 'schedule_conflict':
      return {
        text: 'You are already engaged in a match around that time.',
        action: null,
      };
  }
}
