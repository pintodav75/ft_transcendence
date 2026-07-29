import { useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { MatchHeader } from '@/components/matches/MatchHeader';
import { MatchLineups } from '@/components/matches/MatchLineups';
import { MatchMaps } from '@/components/matches/MatchMaps';
import { MatchScoreboard } from '@/components/matches/MatchScoreboard';
import { MatchStateNotice } from '@/components/matches/MatchStateNotice';
import { ErrorPanel } from '@/components/ui/error-panel';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
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
 * `/matches/$matchId` — the match sheet, IN READING ONLY.
 *
 * Destination of every row of a team's match history: who played whom, on which ladder and
 * which maps, the Bo3 score, the winner, the Elo each CAMP gained or lost, and — for a match
 * still running — what the cycle is waiting for.
 *
 * 🚨 No action, on purpose. Reporting a score, confirming the opponent's report and opening a
 * dispute are [FT-4B]; a camp that has already reported sees the WAIT here, never a form.
 *
 * Access mirrors `GET /matches/{id}`: a participant reads his match in every state, anyone
 * else only once it is `completed` (403 otherwise — the anonymity of open slots and running
 * matches is a product decision, not an accident).
 */
export function MatchDetail() {
  const { matchId } = useParams({ from: '/_authenticated/matches/$matchId' });
  const headingId = useId();

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so
  // the error state is rendered without spending a request — and without the red "Failed to
  // load resource" line that request would leave in the console.
  const validId = isValidMatchId(matchId);
  const matchQuery = useMatch(matchId, validId);

  /**
   * Read ONCE, at mount, deliberately not on a timer.
   *
   * Every countdown on this page ("in 3 h", "22 h left to confirm") is coarse to the minute,
   * and the repo has no ticking clock anywhere (`CreateMatchPanel` seeds its own `nowMs` the
   * same way and refreshes it on demand). An interval here would buy one repaint a minute on
   * a page that is read in seconds, plus an effect to clean up — a cost with no reader.
   *
   * ⚠️ In `useState`, NOT a bare `Date.now()` in the body: `react-hooks/purity` rejects an
   * impure call during render, and it is right — the value would change under React between
   * two renders of the same commit.
   */
  const [nowMs] = useState(() => Date.now());

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

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <section aria-labelledby={headingId} className="panel flex min-w-0 flex-col gap-8 p-6">
        <MatchHeader match={match} sides={sides} headingId={headingId} />

        <MatchScoreboard match={match} sides={sides} />

        <MatchStateNotice match={match} sides={sides} nowMs={nowMs} />

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
