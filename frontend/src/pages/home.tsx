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
 * 🚨 NOT A MIRROR OF THE OTHER TABS. No game grid (`/games` is one click away in the rail), no
 * team list (`/teams` likewise): this page holds only what is ACTIONABLE — what needs me now.
 * Anything that is merely nice to look at belongs on the page whose subject it is.
 *
 * 🔑 EVERY BLOCK IS THEREFORE CONDITIONAL, which is why the onboarding block is not a bonus but
 * the page's DEFAULT content: a brand new account has none of the other six, and a page that
 * renders nothing is worse than no page at all.
 *
 * 🔑 FIVE REQUESTS — FOUR OF THEM ON CACHE KEYS OTHER SCREENS ALREADY USE (the fifth, the open-slot
 * teaser, has its own entry ON PURPOSE) — and `GET /ladders` deliberately not among them. See the
 * docblock of `lib/home.ts`.
 */
export function Home() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  // `null` rather than `''`: the `_authenticated` guard means a signed-out visitor never reaches
  // this component, but a bare "Welcome back," with a dangling comma is not a heading worth
  // shipping for the frame where it could happen.
  const displayName = useAuthStore(
    (state) => state.user?.displayName ?? state.user?.pseudo ?? null,
  );

  /**
   * Landing point for the focus when the §5.1 reminder closes: it is the FIRST thing on the
   * page, so its button disappears with it and the focus would otherwise fall back to `<body>`
   * — a screen-reader user restarting from the very top of the document. That is the defect
   * [FX-FOCUS] already cost a dedicated ticket. A heading is the right target: stable, and it
   * names where the reader has landed.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  /**
   * ⚠️ THE ONLY `role="status"` OF THIS SCREEN (invariant #11). Two live regions fight over the
   * reader, and a `[role=status]` selector taking `.first()` reads whichever it meets — which is
   * why the repo's `Callout` deliberately does not carry the role.
   */
  const announcement = useAnnouncement();

  const { gamesQuery, accountsQuery, matchesQuery, invitationsQuery, slotsQuery } = useHomeData();

  /**
   * The instant every countdown on this page is measured against.
   *
   * `Math.max` of a ticking clock and the last instant the SERVER certified: the tick is what
   * makes « in 2 h 14 » keep counting down in a tab left open (`dataUpdatedAt` alone cannot
   * disagree with the payload it came with), and `dataUpdatedAt` is the floor that keeps a
   * client clock running behind the server from dragging the page backwards. Same pairing as
   * the matchmaking board — and here nothing is gated on it, so a wrong `now` can only ever
   * misprint a countdown, never offer a button the API would refuse.
   */
  const nowMs = Math.max(useSlotClock(), matchesQuery.dataUpdatedAt);

  // Both come from the caches every other screen fills — never a request per row. `undefined`
  // ladders on purpose: naming them would cost a sixth request, see `useHomeLabeller`.
  const labels = useHomeLabeller(gamesQuery.data?.games);
  const matches = matchesQuery.data?.matches ?? [];
  const upcoming = upcomingMatches(matches, nowMs);
  /**
   * The two statuses on a 24 h clock (`awaiting_confirmation`, `disputed`), read straight from
   * `lib/history.ts` rather than re-listed here: one definition, two screens. Nothing filters
   * this page, so unlike `/history` there is no risk of hiding it — but it is still computed
   * from the FULL list, on principle.
   */
  const onTheClock = matches.filter(needsMyAttention);
  // An unknown count degrades to zero, i.e. to rendering nothing: `/teams` shows the real error
  // and owns the actions, so a broken counter must not put a wrong number on this page.
  const invitationCount = invitationsQuery.data?.invitations.length ?? 0;
  /**
   * ⚠️ The server hides slots under the 15-minute bound ONLY as of the instant it answered. A
   * tab left open would keep showing one that has since died — harmless here (this block offers
   * no button), but it would send the reader to `/matchmaking` for a row that is not there any
   * more. The same rule, re-applied on the client between two fetches, costs one filter.
   */
  const openSlots = (slotsQuery.data?.slots ?? []).filter((slot) => !isSlotExpired(slot, nowMs));

  const hasSomething =
    upcoming.length > 0 || onTheClock.length > 0 || invitationCount > 0 || openSlots.length > 0;
  const isLoading = matchesQuery.isPending || invitationsQuery.isPending || slotsQuery.isPending;
  const hasFailed = matchesQuery.isError || invitationsQuery.isError || slotsQuery.isError;

  /**
   * 🚨 THE SIGNAL IS « NO MATCH AT ALL », NOT « THE PAGE IS EMPTY ». The first version demanded
   * that every block be empty, and it was wrong on a real account: a member of four teams with
   * zero matches saw two acceptable slots and therefore NO first steps — precisely the reader
   * the block is written for. `GET /matches/me` unions my solo matches AND my teams' (bench
   * included), so an empty list is the honest "I have not started playing yet".
   *
   * 🚨 AND « I HAVE NOT PLAYED » IS NOT « WE COULD NOT FIND OUT ». The claim rests entirely on
   * the match history, so it is gated on THAT query having SUCCEEDED — never on a spinner and
   * never on a failure. `isSuccess` says both at once. The other two lists are deliberately not
   * part of the condition: an invitations or slots outage says nothing about whether I have
   * played, and letting it hide the block would punish a newcomer for an unrelated hiccup.
   */
  const showOnboarding = matchesQuery.isSuccess && matches.length === 0;

  /**
   * 🚨 « THE PAGE MUST NEVER BE MUTE » MEANS EVER, NOT ONLY WHEN IT IS EMPTY. The first version
   * also demanded `!hasSomething`, and that made the promise false in the case that matters
   * most: `GET /teams/invitations/me` fails in a 500 while I do have a match coming up → the
   * counter degrades to `0` (see `invitationCount`), the block renders nothing, NO notice
   * appears, and a pending invitation is simply invisible. A failure is worth saying whether or
   * not the rest of the page found something.
   *
   * ⚠️ MINUS `matchesQuery.isError`, WHICH HAS ITS OWN `Callout` ABOVE: two sentences for one
   * fact is how a reader learns to skip both. Nothing else is subtracted — in particular not
   * `isLoading`: a query that has already failed while another is still in flight is a failure
   * now, and waiting for the slowest one to land would delay the only signal there is.
   */
  const showPartialFailure = hasFailed && !matchesQuery.isError;

  const { dismissed, dismiss } = useDismissibleReminder(userId);
  /**
   * `undefined` = UNKNOWN (a request is in flight, or it failed), which is NOT "nothing is
   * missing": the banner stays hidden, because shouting a red alarm over data we do not have
   * would be a lie. Same three-valued discipline as `hasLinkedProvider` on the solo page.
   */
  const missing = missingProviders(gamesQuery.data?.games, accountsQuery.data?.externalAccounts);
  const showReminder = !dismissed && missing !== undefined && missing.length > 0;

  function dismissReminder() {
    dismiss();
    /**
     * 🚨 THE ANNOUNCEMENT STATES WHAT HAPPENED AND STOPS THERE. It used to add « You can still
     * link an account from your profile », which was simply FALSE: `/profile` renders a
     * placeholder today, so a screen-reader user was being sent to an empty page by the one
     * sentence he could not see was wrong. Confirming the action is the whole job of a live
     * region here — same idiom as `slotRefusal`, which states a fact and stops.
     *
     * ⚠️ NOT THE SAME QUESTION AS THE BANNER'S `/profile` LINK, which deliberately stays (see
     * `LinkAccountBanner`): a link is an invitation the reader can weigh, whereas this sentence
     * ASSERTS that something can be done there — and it cannot, yet.
     */
    announcement.announce('Account linking reminder dismissed.');
    headingRef.current?.focus();
  }

  return (
    <div className="panel flex min-w-0 flex-col gap-6 p-6">
      {/**
       * 🔑 THE HERO REUSES THE LANDING'S RECIPE, NOT ITS COMPONENT. `HeroBanner` carries « Join
       * the arena » / « Enter the arena » towards `/register` and `/login`, which are meaningless
       * to someone already signed in — and generalising it would mean parameterising the very
       * thing that differs (the calls to action) to share the very thing that is trivial (an
       * `<img>` and a gradient). Same arbitration as `CreateMatchPanel`: we share the RULES, not
       * the markup. What is shared here is the art direction, and it is three lines.
       *
       * ⚠️ FOUR CLASS STRINGS ARE COPIED VERBATIM FROM `components/landing/HeroBanner.tsx` (the
       * frame, the image, and the two scrim layers — whose ramp differs here, see below). That
       * is TWO usages, which the repo's rule leaves in place. 🔑 THE THIRD USAGE MUST EXTRACT
       * a `HeroFrame` into `components/ui/` rather than copy them a third time — by then the
       * shared part is proven, and three copies of an art direction drift apart in silence.
       */}
      <header className="relative isolate overflow-hidden rounded-card border border-border-subtle shadow-card">
        {/* `alt=""` + `aria-hidden`: pure decoration. A description here would make every screen
            reader read out a background before the page's own title. */}
        <img
          src={heroUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 size-full object-cover object-[center_70%]"
        />
        {/**
         * ⚠️ THE SCRIM IS STRONGER THAN THE LANDING'S, AND THE NUMBERS SAY WHY. The landing can
         * fade `to-transparent` because its paragraph stops at `max-w-115` inside a full-width
         * banner, far from the bare art. Here the column is only ~625 px (the two rails take the
         * rest), so the text runs the whole width and straight into that transparent end.
         *
         * MEASURED on the composited pixels, worst case over the text's own band, landing recipe
         * copied verbatim: intro **1.20:1**, `<h1>` **1.83:1**, eyebrow **1.15:1** — the artwork
         * has a near-white area right there (rgb(173,158,165) under the paragraph). That is not
         * "a bit tight", it is illegible.
         *
         * With this ramp plus the flat floor below: intro **6.57:1**, `<h1>` **12.63:1**, eyebrow
         * **7.15:1** at 1280 px, and 6.21 / 13.18 / 7.56 at 375 px. All AA, and the intro sits
         * above the repo's known `text-text-muted` debt (4.23:1).
         *
         * 🔑 The text was NOT lightened to get there — the scrim was darkened. Lightening the copy
         * would have made this one paragraph disagree with every other paragraph in the app. If
         * the art ever changes, RE-MEASURE and reinforce the scrim again.
         */}
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-arena-red-soft/95 via-arena-red-soft/85 to-arena-red-soft/70" />
        {/* Second, flat layer: the ramp above handles the left-to-right reading, this one is the
            floor that guarantees the bottom-right corner — where the longest line of the
            paragraph ends — never sits on raw art. */}
        <div className="absolute inset-0 -z-10 bg-background-app/45" />

        <div className="px-6 py-6 md:px-8 md:py-7">
          <p className="flex items-center gap-2 text-xs label-caps text-success">
            <House aria-hidden="true" className="size-4" /> Home
          </p>
          {/* `tabIndex={-1}`: focusable BY SCRIPT ONLY, so nothing changes for someone simply
              tabbing through the page. It stays the page's ONE `<h1>` and the landing point of
              the focus after the reminder is dismissed.

              🚨 `break-words` IS LOAD-BEARING, NOT TIDYING. A pseudo is a single unbreakable
              token of up to 30 characters, and this heading lives inside an `overflow-hidden`
              box (the hero art is `absolute inset-0`, it has to be). Without it, at 375 px
              « WELCOME BACK, PROBE5461829 » lost **63 px of its own text off the right edge** —
              measured — while the document itself did not overflow and every other check stayed
              green. That is the FT-3 lesson applied to a heading: a container that CLIPS never
              overflows, so the only way to see it is to measure the ELEMENT. `H16` does. */}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring mt-1 rounded-control break-words text-3xl label-caps-black"
          >
            {displayName ? `Welcome back, ${displayName}` : 'Welcome back'}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-text-secondary">
            What needs you right now — your next matches, the ones on the clock, and the slots you
            can take. Your teams, the games and your full history are in the rail on the left.
          </p>
        </div>
      </header>

      {/* Mounted for the whole life of the page and only its text changes: a region inserted
          into the DOM together with its content is not reliably announced — the screen reader
          has to be watching it already. `sr-only` is `position: absolute`, so an empty one
          costs no layout. */}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {showReminder && <LinkAccountBanner providers={missing} onDismiss={dismissReminder} />}

      {/* 🚨 SAID OUT LOUD, never silently read as "you have nothing". Four of the seven blocks
          are fed by this one request, so a failure here empties most of the page — and
          "nothing" is exactly what makes the onboarding block appear. */}
      {matchesQuery.isError && (
        <Callout tone="danger">
          Your matches could not be loaded, so what is coming up and what is on the clock are
          missing from this page. Check your connection and reload.
        </Callout>
      )}

      {/* 🔑 AT THE TOP, WITH THE OTHER FAILURE NOTICE — not at the bottom of the page where it
          used to sit. It only ever rendered on an EMPTY screen back then, so anywhere was in
          plain sight; now that it also fires on a full one, the foot of a scrolling page is the
          one place it would never be read. Both notices say « something is missing from this
          screen », so they belong together, above the blocks they are talking about. */}
      {showPartialFailure && (
        <Callout tone="muted">
          Part of this page could not be loaded, so it may be hiding something that needs you.
          Reload to try again.
        </Callout>
      )}

      <UpcomingMatches rows={upcoming} ladderOf={labels.forMatch} nowMs={nowMs} />

      {/* Shared verbatim with `/history` — same component, same copy. 🚨 Its wording must never
          say the match is waiting on ME: the payload cannot support that claim (the side that
          has already submitted, a bench player, a non-captain, and a `disputed` that waits on an
          admin all break it). « on the clock » is the strongest thing true of all four. */}
      <ActionRequired matches={onTheClock} ladderOf={labels.forMatch} />

      <TeamInvitationsTeaser count={invitationCount} />

      <OpenSlotsTeaser slots={openSlots} />

      {/* Only while the page has nothing else to show: a spinner over content that is already
          readable is noise, and every block above renders its own data as soon as it lands. */}
      {!hasSomething && !showOnboarding && isLoading && (
        <p className="text-sm text-text-secondary">Loading what needs you…</p>
      )}

      {showOnboarding && <HomeOnboarding />}
    </div>
  );
}
