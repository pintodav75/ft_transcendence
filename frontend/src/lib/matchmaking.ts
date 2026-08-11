import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { MIN_LEAD_MINUTES } from '@/lib/match-slots';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { paths } from '@/lib/api-types.gen';

type OpenSlotsResponse = paths['/matches']['get']['responses'][200]['content']['application/json'];

export type OpenSlot = OpenSlotsResponse['slots'][number];
export type SlotRefusalReason = NonNullable<OpenSlot['reason']>;
export type SlotFormat = OpenSlot['format'];

export const SLOT_FORMATS = ['1v1', '2v2', '3v3', '5v5'] as const satisfies readonly SlotFormat[];
export const OPEN_SLOTS_LIMIT = 50;

/** Number of players a side fields on this format — 1, 2, 3 or 5. */
export function lineupSize(format: SlotFormat) {
  return Number.parseInt(format, 10);
}

export type OpenSlotFilters = {
  ladderId?: string;
  /** Game slug (`cs2`), never a uuid. */
  gameId?: string;
  format?: SlotFormat;
  /** `true` `?acceptable=true`. `false` the parameter is OMITTED, so everything is listed. */
  acceptableOnly: boolean;
  /** How many slots to ask for. Omitted means `OPEN_SLOTS_LIMIT` — the board's own value. */
  limit?: number;
};

/** A PARAMETER IS OMITTED, NEVER SENT EMPTY. */
function openSlotsSearch(filters: OpenSlotFilters) {
  const params = new URLSearchParams();
  if (filters.ladderId) params.set('ladderId', filters.ladderId);
  if (filters.gameId) params.set('gameId', filters.gameId);
  if (filters.format) params.set('format', filters.format);
  if (filters.acceptableOnly) params.set('acceptable', 'true');
  params.set('limit', String(filters.limit ?? OPEN_SLOTS_LIMIT));

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

/** The board itself. */
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
 */
export function useSlotClock(intervalMs = CLOCK_TICK_MS) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}

/** Has this slot crossed the bound under which nobody can take it any more? */
export function isSlotExpired(slot: OpenSlot, nowMs: number) {
  const at = Date.parse(slot.scheduledAt);
  if (!Number.isFinite(at)) return true;

  return at - nowMs < MIN_LEAD_MINUTES * MINUTE_MS;
}

/**
 * The row keeps its place and states the rule, exactly like a server-side refusal — the board
 * is never allowed to become a dead end, and a row that simply vanished would read as a bug.
 */
export const EXPIRED_SLOT_REFUSAL: SlotRefusal = {
  text: `This slot kicks off in less than ${MIN_LEAD_MINUTES} minutes, so it can no longer be accepted. It leaves the board on the next refresh.`,
  action: null,
};

export function openSlotsErrorMessage(error: unknown) {
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Both are unreachable from this screen — the query string is built above and the ladder is
    // checked against the cached list before it is ever sent.
    if (error.status === 400) return 'This board could not be filtered. Reload the page.';
    if (error.status === 404) return 'That ladder does not exist any more.';
  }

  return 'The open slots could not be loaded. Check your connection and reload the page.';
}

// ------------------------------------------------------------------ refusals

/**
 * The way OUT of a refusal — every reason that has a remedy carries the link to it, which is
 * what keeps this board from being a dead end.
 */
export type RefusalAction =
  | { kind: 'create-team'; ladderId: string; label: string }
  | { kind: 'open-team'; teamId: string; label: string }
  | null;

export type SlotRefusal = { text: string; action: RefusalAction };

type RefusalContext = {
  /**
   * My team on THIS slot's ladder, from the cached `GET /teams` — `undefined` while it loads or
   * if it failed.
   */
  myTeamId: string | undefined;
  /** "Steam", "Riot"… — `undefined` when the game list has not resolved. */
  providerName: string | undefined;
};

/** Turns the server's verdict into a sentence AND a remedy. */
export function slotRefusal(
  slot: OpenSlot,
  reason: SlotRefusalReason,
  { myTeamId, providerName }: RefusalContext,
): SlotRefusal {
  const size = lineupSize(slot.format);
  // The two roster reasons are only ever served to a CAPTAIN, so the id is known as soon as
  // `GET /teams` resolves.
  const team: RefusalAction = myTeamId
    ? { kind: 'open-team', teamId: myTeamId, label: 'Open my team' }
    : null;
  const account = providerName ? `${providerName} account` : 'game account';

  switch (reason) {
    case 'account_not_linked':
      return {
        text: `Playing ${slot.gameName} needs a linked ${account}, and yours is not linked yet.`,
        // No link on purpose: the screen that links an account does not exist yet. A
        // button leading nowhere is worse than a sentence that stops.
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
