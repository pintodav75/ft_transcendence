import { useId, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { MatchHeader } from '@/components/matches/MatchHeader';
import { MatchLineups } from '@/components/matches/MatchLineups';
import { MatchMaps } from '@/components/matches/MatchMaps';
import { MatchResultPanel } from '@/components/matches/MatchResultPanel';
import { MatchScoreboard } from '@/components/matches/MatchScoreboard';
import { MatchStateNotice } from '@/components/matches/MatchStateNotice';
import { ErrorPanel } from '@/components/ui/error-panel';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { useAnnouncement } from '@/lib/use-announcement';
import { isValidMatchId, useMatch } from '@/lib/match-detail';

function BackToTeams() {
  return (
    <Link to="/teams" className={buttonClasses('secondary')}>
      <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
      Back to my teams
    </Link>
  );
}

/**
 * `/matches/$matchId` — the match sheet, and the ONLY place where the cycle can end.
 *
 * Destination of every row of a team's match history: who played whom, on which ladder and
 * which maps, the Bo3 score, the winner, the Elo each CAMP gained or lost, and — for a match
 * still running — what the cycle is waiting for.
 *
 * [FT-4B] added the write side, in `MatchResultPanel`: reporting a score, confirming the
 * opponent's report, contesting it. Everything else here stays read-only, and the panel
 * renders NOTHING for anyone who may not act — a button the API would refuse leaves a red
 * line in the console, which is a project-rejection criterion.
 *
 * Access mirrors `GET /matches/{id}`: a participant reads his match in every state, anyone
 * else only once it is `completed` (403 otherwise — the anonymity of open slots and running
 * matches is a product decision, not an accident).
 */
export function MatchDetail() {
  const { matchId } = useParams({ from: '/_authenticated/matches/$matchId' });
  const headingId = useId();
  // Landing point for focus after a result is reported: the control that had it is gone with
  // the form, and `<body>` would throw a keyboard user back to the top of the document.
  const headingRef = useRef<HTMLHeadingElement>(null);
  // ONE announcement for the whole screen — see the live region below.
  const resultAnnouncement = useAnnouncement();

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so
  // the error state is rendered without spending a request — and without the red "Failed to
  // load resource" line that request would leave in the console.
  const validId = isValidMatchId(matchId);
  const matchQuery = useMatch(matchId, validId);

  if (!validId) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Invalid match link"
          message="This match identifier is not a valid id. Check the link you followed, or open the match from one of your teams."
        >
          <BackToTeams />
        </ErrorPanel>
      </div>
    );
  }

  if (matchQuery.isError) {
    const status = matchQuery.error instanceof ApiError ? matchQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 403 ? (
          // Neither an outage nor a dead end: the sheet EXISTS, it is simply private until
          // the match is over. Saying so is what stops someone reloading forever.
          <ErrorPanel
            title="Reserved for the two sides"
            message="Only the players and team-mates engaged in this match can read it while it is running. It becomes public as soon as the match is completed."
          >
            <BackToTeams />
          </ErrorPanel>
        ) : status === 404 ? (
          <ErrorPanel
            title="Match not found"
            message="No match answers to this link. It may have been played by teams that no longer exist, or the link may simply be mistyped."
          >
            <BackToTeams />
          </ErrorPanel>
        ) : (
          <ErrorPanel
            title="Match unavailable"
            message="This match could not be loaded. Check your connection and reload the page."
          >
            <BackToTeams />
          </ErrorPanel>
        )}
      </div>
    );
  }

  if (!matchQuery.data) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {/* Same footprint as the loaded panel so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        {/* THE live region of this screen — there must only ever be one, and no other
            element below carries `role="status"`. */}
        <p role="status" className="text-sm text-text-muted">
          Loading the match…
        </p>
      </div>
    );
  }

  const { match, sides } = matchQuery.data;

  /**
   * The clock every deadline on this page is read against — and, since [FT-4B], the one that
   * decides whether the result form is offered at all (§5.3: the API refuses a result before
   * kick-off).
   *
   * ⚠️ NOT frozen at mount any more, and not a timer either: `dataUpdatedAt` is the instant
   * this payload came back, so it moves forward on every refetch — including the automatic
   * one when the tab regains focus. A clock frozen at mount kept the form hidden for as long
   * as a tab opened before kick-off stayed open, and only a RELOAD could cure it. Every
   * countdown here stays coarse to the minute, so an interval would still buy nothing but a
   * repaint.
   *
   * ⚠️ Be precise about what this does and does not fix: the clock advances on a refetch, not
   * on the wall clock. The query client runs with `staleTime: 0` and `refetchOnWindowFocus`,
   * so LEAVING the tab and coming back is enough — but a tab left in the foreground across
   * kick-off still shows no form until something refetches. That is deliberate rather than
   * lucky: the flow that leads here is "report the result of games you have just played
   * elsewhere", so the tab is left and regained by construction, and polling for the hours or
   * days a match can be scheduled ahead would cost far more than it buys.
   *
   * ⚠️ A cached payload can make this LAG behind the wall clock for a moment. That errs on
   * the safe side by construction: an older `now` can only ever hide the form, never offer a
   * button the server would refuse.
   */
  const nowMs = matchQuery.dataUpdatedAt;

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      {/* THE live region of this screen, MOUNTED FOR THE WHOLE LIFE OF THE PAGE, its text
          alone changing: a region inserted into the DOM together with its content is not
          reliably announced. It is also the only one in this branch — the loading state
          above has its own, and the two never coexist. `sr-only` is `position: absolute`, so
          an empty region costs no layout. */}
      <p role="status" className="sr-only">
        {resultAnnouncement.message}
      </p>

      <section aria-labelledby={headingId} className="panel flex min-w-0 flex-col gap-8 p-6">
        <MatchHeader match={match} sides={sides} headingId={headingId} headingRef={headingRef} />

        <MatchScoreboard match={match} sides={sides} />

        <MatchStateNotice match={match} sides={sides} nowMs={nowMs} />

        {/* Between the state notice and the maps: what the cycle is waiting for, then what
            *I* can do about it, then the detail of the match. Renders nothing at all for a
            visitor, a bench player, or a match that is not waiting for a result. */}
        <MatchResultPanel
          match={match}
          sides={sides}
          nowMs={nowMs}
          returnFocusRef={headingRef}
          onReported={resultAnnouncement.announce}
        />

        {/* Driven by the DATA: only cs2 and Valorant have a map pool today, so a chess or a
            LoL match renders no section at all rather than an empty one. */}
        {match.maps.length > 0 && <MatchMaps maps={match.maps} gameName={match.ladder.gameName} />}

        <MatchLineups match={match} sides={sides} />

        <p className="text-xs text-text-muted">
          Elo is shown per CAMP: a match moves one ladder line per side — a team&apos;s, or a
          player&apos;s in 1v1 — never one per player.
        </p>
      </section>

      <Link
        to="/ladders/$ladderId"
        params={{ ladderId: match.ladderId }}
        // `py-1` takes the standalone link from 16 px to 24 px, the WCAG 2.5.8 floor.
        className="focus-ring inline-flex items-center gap-2 self-start py-1 text-xs label-caps text-text-secondary transition hover:text-text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {match.ladder.name} standings
      </Link>
    </div>
  );
}
