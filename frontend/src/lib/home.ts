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
 * Read side of `/home` — the landing screen of a signed-in account.
 *
 * 🚨 `/home` IS NOT A MIRROR OF THE OTHER TABS, and that is the decision that shapes this whole
 * module. No game grid (`/games` exists), no team list (`/teams` exists): the page holds only
 * what is ACTIONABLE — what needs me now. Everything here is therefore conditional, which is
 * exactly why the onboarding block is not a bonus but the page's DEFAULT content: a brand new
 * account has none of the six other blocks.
 *
 * 🔑 THE BUDGET IS FIVE REQUESTS, AND FOUR OF THE FIVE LAND ON A CACHE KEY ANOTHER SCREEN
 * ALREADY USES — `['games']` (`/games`), `EXTERNAL_ACCOUNTS_KEY` (`/solo` and `/profile`),
 * `['matches', 'me', 'all']` (`/history`) and `MY_INVITATIONS_KEY` (`/teams`). `/home` is a READER of
 * the app's caches, so arriving on it never makes a later page slower.
 *
 * ⚠️ THE FIFTH IS THE EXCEPTION, AND IT IS NOT AN ACCIDENT: the open-slot teaser has its OWN
 * cache entry, distinct from `/matchmaking`'s board. `openSlotsKey` IS the whole filter object,
 * and `limit: 3` is part of it — so `{acceptableOnly:true, limit:3}` and the board's
 * `{gameId, format, acceptableOnly}` can never collide. That is deliberate (see
 * `lib/matchmaking.ts`): they are two different lists, and sharing an entry would mean one
 * screen serving the other's truncation. The teaser costs one request; the board keeps its key
 * byte-identical to what it was before `/home` existed.
 *
 * 🚨 AND `GET /ladders` IS DELIBERATELY *NOT* AMONG THEM. Naming the ladder of a row is the one
 * thing that would have cost a sixth request; `matchLabeller` already falls back to
 * `<game> <format>` (see `useHomeLabeller`), so the page reads correctly without it. This is a
 * real constraint, not an accident: `f-nav`'s `N5` check measures it, and it is what keeps the
 * search bar's "the ladder table costs nothing until somebody searches" guarantee provable.
 */

// ------------------------------------------------------------------ queries

/** How many open slots the teaser shows before sending the reader to `/matchmaking`. */
export const HOME_SLOTS_LIMIT = 3;

/**
 * Names the ladder of every row WITHOUT `GET /ladders`.
 *
 * ⚠️ THE FALLBACK IS EXACT FOR 8 LADDERS OUT OF 9, NOT ALL 9 — do not read this as an
 * equality. `matchLabeller(undefined, games)` renders `<game> <format>`, which is verbatim the
 * name of Chess 1v1, Counter-Strike 2 5v5, League of Legends 5v5, Rocket League 1v1/2v2/3v3 and
 * Valorant 2v2/5v5. The exception is **« Counter-Strike 2 2v2 (Wingman) »**, which comes out as
 * « Counter-Strike 2 2v2 »: still unambiguous (a ladder IS the pair game × format, enforced by
 * `ladders_game_format_unique`), but it loses the nickname. That is the price of not spending a
 * sixth request on this screen, and it is a price we chose — not a guarantee.
 */
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
   * ⚠️ `acceptableOnly` is what makes this block safe to render without a verdict: the server
   * only returns slots this account could actually take, so there is no refusal to phrase and
   * no button to grey out. `limit: 3` keeps it a teaser — `/matchmaking` is the board.
   */
  const slotsQuery = useOpenSlots({ acceptableOnly: true, limit: HOME_SLOTS_LIMIT });

  return { gamesQuery, accountsQuery, matchesQuery, invitationsQuery, slotsQuery };
}

// -------------------------------------------------------- §5.1 linked accounts

/**
 * Which providers this platform requires that I have NOT linked.
 *
 * 🚨 THREE-VALUED, and the third value is the whole point: `undefined` means UNKNOWN (a request
 * is in flight, or it failed), which is not the same as "nothing is missing". The banner must
 * stay hidden in that case — the same discipline `hasLinkedProvider` applies to the solo page,
 * for the same reason: shouting a red alarm on data we do not have would be a lie, and hiding
 * it costs nothing.
 *
 * ⚠️ DRIVEN BY THE DATA, NEVER BY A HARD-CODED LIST. The requirement is `games.required_provider`
 * (served as `requiredProvider`), so adding a game lights this up for free. `GET /games` already
 * filters `is_active` server-side, so every game returned really does demand its account.
 *
 * 🔑 THE SCOPE IS EVERY GAME OF THE PLATFORM, not just the ones I have a team on. Narrowing it to
 * "my" games would mean the reminder never fires for a brand new account — which is precisely
 * its audience.
 *
 * Ordered by the front's display order (`sortGames`) so the sentence is stable between renders.
 */
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

/**
 * « Steam and Riot », « Steam, Riot and Epic ».
 *
 * `Intl.ListFormat` rather than a hand-rolled join: it puts the conjunction in the right place
 * for any length, and it is in the platform — no dependency for three words. Locale FIXED to
 * `en-GB` like every other formatter of this repo, never the browser's.
 */
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
  /**
   * When `cancelExpiredSlots` will withdraw an unaccepted slot — `null` on anything else.
   *
   * 🔑 THIS IS THE ONE GENUINELY NEW PIECE OF INFORMATION ON THE PAGE. The job cancels a
   * `pending` slot as soon as it falls under `MIN_LEAD_MINUTES` of its OWN kick-off (the instant
   * nobody can accept it any more), and nothing else in the app ever shows that deadline.
   * ⚠️ It is NOT the 24 h rule — that one belongs to the reported-score job and lives on the
   * "Matches on the clock" section.
   */
  withdrawnAtMs: number | null;
};

/**
 * The commitments ahead of me, soonest first.
 *
 * Two statuses qualify, and only two:
 *   • `in_progress` — accepted by somebody, so it WILL be played. Kept even once its kick-off
 *     has passed: a match under way is still the next thing on my schedule, and dropping it
 *     would make it vanish from the page between kick-off and the score being reported.
 *   • `pending` — my own open slot, kept while its kick-off is still ahead. Past that it is a
 *     dead line the job is about to cancel, and the row says so through `withdrawnAtMs`.
 *
 * `awaiting_confirmation` and `disputed` are deliberately absent: they are behind me, not ahead,
 * and they have their own section (the 24 h clock).
 *
 * ⚠️ `scheduledAt` is an ISO **string** that can be null (invariant #8) — `new Date(null)`
 * silently yields 1970, so an unparsable or missing date drops the row instead of sorting it
 * to the dawn of time.
 *
 * Sorted ascending and tie-broken by id: the kick-offs are constrained to a quarter-hour grid,
 * so ties are frequent, and without a second criterion two rows could swap on a refetch.
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

/**
 * « in 18h 43m », « in 43 min », « in 3 days ».
 *
 * 🚨 EVERY UNIT IS SPELLED OUT, AND THAT IS A CORRECTION OF A REAL DEFECT. The first version
 * rendered `in ${hours} h ${minutes}` with the minutes padded to two digits — « in 18 h 43 »,
 * which the eye reads as the CLOCK TIME 18:43, and « in 18 h 03 » is not distinguishable from
 * one at all. It was not a theoretical risk: this very page prints real clock times right beside
 * it (a kick-off at `22:00`, a withdrawal at `21:45`), so the two were guaranteed to be confused.
 * Carrying the `m` is what makes the number a duration. Do not drop it back for tidiness.
 *
 * ⚠️ NO IMPERATIVE, EVER, and no claim about who must act. A past kick-off reads « under way »
 * and nothing more: the payload of `GET /matches/me` never says who submitted a score, so
 * « report your score » would be false for a bench player, for a non-captain, and for the side
 * that has already reported — the exact trap `/history` had to walk back (« Waiting on you »).
 */
export function formatCountdown(atMs: number, nowMs: number) {
  const delta = atMs - nowMs;

  if (delta <= 0) return 'under way';
  if (delta < MINUTE_MS) return 'in less than a minute';

  // Under the hour there is only one number, so `min` on its own cannot be misread.
  if (delta < HOUR_MS) return `in ${Math.floor(delta / MINUTE_MS)} min`;

  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    const minutes = Math.floor((delta % HOUR_MS) / MINUTE_MS);
    // ⚠️ NO « in 19h 0m ». A zero minute count is not information, it reads as a rendering
    // fault, and slots land on a quarter-hour grid so it comes up often. The column loses a
    // little width uniformity; a value that looks broken costs more.
    if (minutes === 0) return `in ${hours}h`;
    // No zero-padding: with its unit attached, `3m` is unambiguous, and `03m` would be a
    // leftover of the clock format this deliberately stopped looking like.
    return `in ${hours}h ${minutes}m`;
  }

  const days = Math.round(delta / DAY_MS);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * `20:45` — the withdrawal deadline of an open slot.
 *
 * Time only, because the row already carries the full kick-off date right beside it; repeating
 * the day would push the line past the width this column has. `en-GB` keeps the 24-hour clock,
 * and the locale is hard-coded so the same slot reads identically for everyone (and so an audit
 * check comparing it does not depend on the host's locale).
 */
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatClockTime(atMs: number) {
  return clockFormat.format(new Date(atMs));
}

// ------------------------------------------------- dismissing the §5.1 reminder

/**
 * 🚨 THE KEY IS PREFIXED BY THE USER ID, AND THAT IS NOT A DETAIL. Three dev accounts
 * (`alice` / `bob` / `carol`) are juggled in the same Chrome all day, the console audit
 * included. On a shared key, one account dismissing the reminder would silently hide it for
 * the next — a defect that reproduces once, looks like a rendering bug, and is very hard to
 * pin on storage.
 */
const DISMISS_PREFIX = 'ft:home:link-accounts-dismissed:';

/**
 * ⚠️ EVERY ACCESS IS GUARDED. `localStorage` throws on a `SecurityError` (cookies blocked for
 * the origin), and reading it happens during the very first render: an exception there is a
 * white screen, not a missing banner. A storage that cannot be read simply means "not
 * dismissed", so the worst case is a reminder the user has to close again.
 */
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

/**
 * "Never show me this again", persisted per account.
 *
 * 🔑 THE STATE IS RE-DERIVED WHEN THE ACCOUNT CHANGES, rather than assumed to remount. Signing
 * out does unmount this page today, so a remount would be enough — but that is a property of
 * the router, not of this hook, and the day it changes the reminder would show the previous
 * user's answer. Adjusting state during render is React's documented pattern for exactly this
 * (no effect, no extra commit, no wasted paint) — an effect would render one frame with the
 * wrong answer on screen.
 */
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
