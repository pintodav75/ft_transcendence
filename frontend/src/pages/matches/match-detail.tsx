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
import { backLinkClasses, useBackFrom } from '@/lib/back-navigation';
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

/** `/matches/$matchId` — the match sheet, and the ONLY place where the cycle can end. */
export function MatchDetail() {
  const { matchId } = useParams({ from: '/_authenticated/matches/$matchId' });
  const headingId = useId();
  // Landing point for focus after a result is reported: the control that had it is gone with
  // the form, and `<body>` would throw a keyboard user back to the top of the document.
  const headingRef = useRef<HTMLHeadingElement>(null);
  // ONE announcement for the whole screen — see the live region below.
  const resultAnnouncement = useAnnouncement();
  // Read HERE, not inline in the JSX below: this component returns early on a malformed id and
  // on every error state, so a hook called down there would run conditionally.
  const backFrom = useBackFrom();

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so the
  // error state is rendered without spending a request — and without the red "Failed to load
  // resource" line that request would leave in the console.
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
          // Neither an outage nor a dead end: the sheet EXISTS, it is simply private until the
          // match is over. Saying so is what stops someone reloading forever.
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

        <p role="status" className="text-sm text-text-muted">
          Loading the match…
        </p>
      </div>
    );
  }

  const { match, sides } = matchQuery.data;

  /**
   * The clock every deadline on this page is read against — and the one that
   * decides whether the result form is offered at all (§5.3: the API refuses a result before
   * kick-off).
   */
  const nowMs = matchQuery.dataUpdatedAt;

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">

      <p role="status" className="sr-only">
        {resultAnnouncement.message}
      </p>

      <section aria-labelledby={headingId} className="panel flex min-w-0 flex-col gap-8 p-6">
        <MatchHeader match={match} sides={sides} headingId={headingId} headingRef={headingRef} />

        <MatchScoreboard match={match} sides={sides} />

        <MatchStateNotice match={match} sides={sides} nowMs={nowMs} />

        <MatchResultPanel
          match={match}
          sides={sides}
          nowMs={nowMs}
          returnFocusRef={headingRef}
          onReported={resultAnnouncement.announce}
        />

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
        state={backFrom}
        className={backLinkClasses}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {match.ladder.name} standings
      </Link>
    </div>
  );
}
