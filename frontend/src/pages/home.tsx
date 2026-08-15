import { House } from 'lucide-react';
import { useRef } from 'react';

import heroUrl from '@/assets/images/bg.webp';
import { ActionRequired } from '@/components/matches/ActionRequired';
import { Callout } from '@/components/ui/callout';
import { HomeOnboarding } from '@/components/home/HomeOnboarding';
import { LinkAccountBanner } from '@/components/home/LinkAccountBanner';
import { OpenSlotsTeaser } from '@/components/home/OpenSlotsTeaser';
import { TeamInvitationsTeaser } from '@/components/home/TeamInvitationsTeaser';
import { UpcomingMatches } from '@/components/home/UpcomingMatches';
import { needsMyAttention } from '@/lib/history';
import {
  missingProviders,
  upcomingMatches,
  useDismissibleReminder,
  useHomeData,
  useHomeLabeller,
} from '@/lib/home';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';
import { isSlotExpired, useSlotClock } from '@/lib/matchmaking';

/**
 * `/home` — the landing screen of a signed-in account.
 *
 * only what is ACTIONABLE: no game grid, no team list, those tabs are one click away in the
 * rail. anything that's just nice to look at belongs on the page whose subject it is.
 * every block is conditional, so onboarding is the default content — a new account has none of
 * the other six.
 * request budget and cache keys are explained in lib/home.ts.
 */
export function Home() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  // `null` rather than `''`: the `_authenticated` guard means a signed-out visitor never
  // reaches this component, but a bare "Welcome back," with a dangling comma is not a heading
  // worth shipping for the frame where it could happen.
  const displayName = useAuthStore(
    (state) => state.user?.displayName ?? state.user?.pseudo ?? null,
  );

  /**
   * Landing point for the focus when the §5.1 reminder closes: it is the FIRST thing on the
   * page, so its button disappears with it and the focus would otherwise fall back to `<body>`
   * — a screen-reader user restarting from the very top of the document.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** THE ONLY `role="status"` OF THIS SCREEN (invariant #11). */
  const announcement = useAnnouncement();

  const { gamesQuery, accountsQuery, matchesQuery, invitationsQuery, slotsQuery } = useHomeData();

  /** The instant every countdown on this page is measured against. */
  const nowMs = Math.max(useSlotClock(), matchesQuery.dataUpdatedAt);

  // Both come from the caches every other screen fills — never a request per row.
  const labels = useHomeLabeller(gamesQuery.data?.games);
  const matches = matchesQuery.data?.matches ?? [];
  const upcoming = upcomingMatches(matches, nowMs);
  /**
   * The two statuses on a 24 h clock (`awaiting_confirmation`, `disputed`), read straight from
   * `lib/history.ts` rather than re-listed here: one definition, two screens.
   */
  const onTheClock = matches.filter(needsMyAttention);
  // An unknown count degrades to zero, i.e.
  const invitationCount = invitationsQuery.data?.invitations.length ?? 0;
  /** The server hides slots under the 15-minute bound ONLY as of the instant it answered. */
  const openSlots = (slotsQuery.data?.slots ?? []).filter((slot) => !isSlotExpired(slot, nowMs));

  const hasSomething =
    upcoming.length > 0 || onTheClock.length > 0 || invitationCount > 0 || openSlots.length > 0;
  const isLoading = matchesQuery.isPending || invitationsQuery.isPending || slotsQuery.isPending;
  const hasFailed = matchesQuery.isError || invitationsQuery.isError || slotsQuery.isError;

  /** THE SIGNAL IS « NO MATCH AT ALL », NOT « THE PAGE IS EMPTY ». */
  const showOnboarding = matchesQuery.isSuccess && matches.length === 0;

  /** « THE PAGE MUST NEVER BE MUTE » MEANS EVER, NOT ONLY WHEN IT IS EMPTY. */
  const showPartialFailure = hasFailed && !matchesQuery.isError;

  const { dismissed, dismiss } = useDismissibleReminder(userId);
  /**
   * `undefined` = UNKNOWN (a request is in flight, or it failed), which is NOT "nothing is
   * missing": the banner stays hidden, because shouting a red alarm over data we do not have
   * would be a lie.
   */
  const missing = missingProviders(gamesQuery.data?.games, accountsQuery.data?.externalAccounts);
  const showReminder = !dismissed && missing !== undefined && missing.length > 0;

  function dismissReminder() {
    dismiss();
    /**
     * The announcement states what happened and stops there — confirming the action is the
     * whole job of a live region, same idiom as `slotRefusal`.
     */
    announcement.announce('Account linking reminder dismissed.');
    headingRef.current?.focus();
  }

  return (
    <div className="panel flex min-w-0 flex-col gap-6 p-6">

      <header className="relative isolate overflow-hidden rounded-card border border-border-subtle shadow-card">

        <img
          src={heroUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 size-full object-cover object-[center_70%]"
        />

        <div className="absolute inset-0 -z-10 bg-linear-to-r from-arena-red-soft/95 via-arena-red-soft/85 to-arena-red-soft/70" />

        <div className="absolute inset-0 -z-10 bg-background-app/45" />

        <div className="px-6 py-6 md:px-8 md:py-7">
          <p className="flex items-center gap-2 text-xs label-caps text-success">
            <House aria-hidden="true" className="size-4" /> Home
          </p>

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring mt-1 rounded-control wrap-break-word text-3xl label-caps-black"
          >
            {displayName ? `Welcome back, ${displayName}` : 'Welcome back'}
          </h1>

          <p className="mt-2 max-w-prose text-sm text-text-secondary">
            What needs you right now — your next matches, the ones on the clock, and the slots you
            can take. Your teams, the games and your full history are one tap away in the navigation
            menu.
          </p>
        </div>
      </header>

      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {showReminder && <LinkAccountBanner providers={missing} onDismiss={dismissReminder} />}

      {matchesQuery.isError && (
        <Callout tone="danger">
          Your matches could not be loaded, so what is coming up and what is on the clock are
          missing from this page. Check your connection and reload.
        </Callout>
      )}

      {showPartialFailure && (
        <Callout tone="muted">
          Part of this page could not be loaded, so it may be hiding something that needs you.
          Reload to try again.
        </Callout>
      )}

      <UpcomingMatches rows={upcoming} ladderOf={labels.forMatch} nowMs={nowMs} />

      <ActionRequired matches={onTheClock} ladderOf={labels.forMatch} />

      <TeamInvitationsTeaser count={invitationCount} />

      <OpenSlotsTeaser slots={openSlots} />

      {!hasSomething && !showOnboarding && isLoading && (
        <p className="text-sm text-text-secondary">Loading what needs you…</p>
      )}

      {showOnboarding && <HomeOnboarding />}
    </div>
  );
}
