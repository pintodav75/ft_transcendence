import { useState } from 'react';

import { MIN_LEAD_MINUTES } from '@/lib/match-slots';
import { matchLabeller, useMyMatchHistory } from '@/lib/history';
import { sortGames, useGames } from '@/lib/games';
import { useExternalAccounts } from '@/lib/external-accounts';
import { useMyTeamInvitations } from '@/lib/teams';
import { useOpenSlots } from '@/lib/matchmaking';

import type { ExternalAccount } from '@/lib/external-accounts';
import type { Game, RequiredProvider } from '@/lib/games';
import type { HistoryMatch, MatchLabeller } from '@/lib/history';

/**
 * Read side of /home. The page only holds what is ACTIONABLE (no game grid, no team list —
 * those tabs exist), so every block is conditional and onboarding is the default content.
 *
 * budget is 5 requests, 4 of them on cache keys another screen already uses (['games'],
 * EXTERNAL_ACCOUNTS_KEY, ['matches','me','all'], MY_INVITATIONS_KEY). /home reads the app's
 * caches, it never makes a later page slower.
 * the 5th is the open-slots teaser, which has its OWN entry: openSlotsKey is the whole filter
 * object and limit:3 is part of it, so it can't collide with /matchmaking's board and one
 * screen can't serve the other's truncation.
 * GET /ladders is deliberately not in there — matchLabeller falls back to `<game> <format>`.
 */

// ------------------------------------------------------------------ queries

/** How many open slots the teaser shows before sending the reader to `/matchmaking`. */
export const HOME_SLOTS_LIMIT = 3;

/** Names the ladder of every row WITHOUT `GET /ladders`. */
export function useHomeLabeller(games: Game[] | undefined): MatchLabeller {
  return matchLabeller(undefined, games);
}

/** Everything `/home` reads, in one place — five requests, no more (see the module docblock). */
export function useHomeData() {
  const gamesQuery = useGames();
  const accountsQuery = useExternalAccounts();
  const matchesQuery = useMyMatchHistory();
  const invitationsQuery = useMyTeamInvitations();
  /**
   * `acceptableOnly` is what makes this block safe to render without a verdict: the server only
   * returns slots this account could actually take, so there is no refusal to phrase and no
   * button to grey out.
   */
  const slotsQuery = useOpenSlots({ acceptableOnly: true, limit: HOME_SLOTS_LIMIT });

  return { gamesQuery, accountsQuery, matchesQuery, invitationsQuery, slotsQuery };
}

// -------------------------------------------------------- §5.1 linked accounts

/** Which providers this platform requires that I have NOT linked. */
export function missingProviders(
  games: Game[] | undefined,
  accounts: ExternalAccount[] | undefined,
): RequiredProvider[] | undefined {
  if (!games || !accounts) return undefined;

  const linked = new Set(accounts.map((account) => account.provider));
  const missing: RequiredProvider[] = [];

  for (const game of sortGames(games)) {
    if (linked.has(game.requiredProvider)) continue;
    if (missing.includes(game.requiredProvider)) continue;
    missing.push(game.requiredProvider);
  }

  return missing;
}

/** « Steam and Riot », « Steam, Riot and Epic ». */
const providerListFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

export function formatProviderList(names: string[]) {
  return providerListFormat.format(names);
}

// ------------------------------------------------------------------ what's next

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One row of the "Next up" section: a match ahead of me, or a slot of mine nobody took. */
export type UpcomingMatch = {
  match: HistoryMatch;
  /** Kick-off, as epoch ms — parsed once here so no renderer re-parses a string. */
  atMs: number;
  /**
   * My own slot, still waiting for an opponent. `pending` can only ever mean that: a match
   * gains its second side by being accepted, which moves it to `in_progress`.
   */
  isOpenSlot: boolean;
  /** When `cancelExpiredSlots` will withdraw an unaccepted slot — `null` on anything else. */
  withdrawnAtMs: number | null;
};

/**
 * The commitments ahead of me, soonest first. Two statuses qualify:
 *   - in_progress: someone accepted, it will be played. kept even past kick-off, otherwise it
 *     vanishes between kick-off and the score being reported.
 *   - pending: my own open slot, while kick-off is still ahead. past that the job is about to
 *     cancel it and the row says so through withdrawnAtMs.
 * awaiting_confirmation and disputed are behind me, not ahead — they have their own section.
 *
 * scheduledAt is an ISO string that can be null, and new Date(null) gives 1970, so an
 * unparsable date drops the row instead of sorting it to the dawn of time.
 * tie-broken by id: kick-offs sit on a quarter-hour grid so ties are common, and without it
 * two rows swap on a refetch.
 */
export function upcomingMatches(matches: HistoryMatch[], nowMs: number): UpcomingMatch[] {
  const rows: UpcomingMatch[] = [];

  for (const match of matches) {
    if (match.status !== 'pending' && match.status !== 'in_progress') continue;
    if (!match.scheduledAt) continue;

    const atMs = Date.parse(match.scheduledAt);
    if (!Number.isFinite(atMs)) continue;

    const isOpenSlot = match.status === 'pending';
    if (isOpenSlot && atMs <= nowMs) continue;

    rows.push({
      match,
      atMs,
      isOpenSlot,
      withdrawnAtMs: isOpenSlot ? atMs - MIN_LEAD_MINUTES * MINUTE_MS : null,
    });
  }

  return rows.sort((a, b) => a.atMs - b.atMs || a.match.id.localeCompare(b.match.id));
}

/** « in 18h 43m », « in 43 min », « in 3 days ». */
export function formatCountdown(atMs: number, nowMs: number) {
  const delta = atMs - nowMs;

  if (delta <= 0) return 'under way';
  if (delta < MINUTE_MS) return 'in less than a minute';

  // Under the hour there is only one number, so `min` on its own cannot be misread.
  if (delta < HOUR_MS) return `in ${Math.floor(delta / MINUTE_MS)} min`;

  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    const minutes = Math.floor((delta % HOUR_MS) / MINUTE_MS);
    // NO « in 19h 0m ». A zero minute count is not information, it reads as a rendering fault,
    // and slots land on a quarter-hour grid so it comes up often.
    if (minutes === 0) return `in ${hours}h`;
    // No zero-padding: with its unit attached, `3m` is unambiguous, and `03m` would be a
    // leftover of the clock format this deliberately stopped looking like.
    return `in ${hours}h ${minutes}m`;
  }

  const days = Math.round(delta / DAY_MS);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** `20:45` — the withdrawal deadline of an open slot. */
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatClockTime(atMs: number) {
  return clockFormat.format(new Date(atMs));
}

// ------------------------------------------------- dismissing the §5.1 reminder

/** THE KEY IS PREFIXED BY THE USER ID, AND THAT IS NOT A DETAIL. */
const DISMISS_PREFIX = 'ft:home:link-accounts-dismissed:';

/** EVERY ACCESS IS GUARDED. */
function readDismissed(userId: string | null) {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(`${DISMISS_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(userId: string | null) {
  if (!userId) return;
  try {
    window.localStorage.setItem(`${DISMISS_PREFIX}${userId}`, '1');
  } catch {
    // Nothing to do and nothing to say: the choice will not survive the reload, which is
    // strictly better than crashing the page over a preference.
  }
}

/** "Never show me this again", persisted per account. */
export function useDismissibleReminder(userId: string | null) {
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  const [knownUserId, setKnownUserId] = useState(userId);

  if (knownUserId !== userId) {
    setKnownUserId(userId);
    setDismissed(readDismissed(userId));
  }

  const dismiss = () => {
    writeDismissed(userId);
    setDismissed(true);
  };

  return { dismissed, dismiss };
}
