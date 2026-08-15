import { Link } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';

import { GameLadderCard } from '@/components/games/GameLadderCard';
import { buttonClasses } from '@/components/ui/button-variants';
import { findTeamStanding, findUserStanding, ladderRankingsOptions } from '@/lib/ladders';
import { useAuthStore } from '@/stores/auth-store';
import { useLadders } from '@/lib/games';
import { useMyTeams } from '@/lib/teams';

import type { RankingEntry } from '@/lib/ladders';
import type { Ladder } from '@/lib/games';
import type { TeamListItem } from '@/lib/teams';

/** How many rows of the board this excerpt shows. The full one is on `/ladders/$ladderId`. */
const PODIUM_SIZE = 3;

/** Every ladder of one game, each with its podium, my line on it and the way in. */
/**
 * Team size of a format, read FROM the format (`1v1` -> 1, `5v5` -> 5) — never from a list of
 * the four that exist today. A migration adding `4v4` must sort itself.
 */
function teamSize(format: string) {
  const size = Number.parseInt(format, 10);
  return Number.isNaN(size) ? -1 : size;
}

export function GameLadderCards({ gameId }: { gameId: string }) {
  const laddersQuery = useLadders();
  const ladders = (laddersQuery.data?.ladders ?? [])
    .filter((ladder) => ladder.gameId === gameId)
    // Biggest format first: `GET /ladders` sorts by name, which opened the page on an empty
    // 2v2 card. Safe to sort in place because `filter` above returned a new array.
    .sort((a, b) => teamSize(b.format) - teamSize(a.format) || a.name.localeCompare(b.name));
  // Selector form so these cards re-render on the user, not on every token refresh.
  const meId = useAuthStore((state) => state.user?.id);
  const myTeams = useMyTeams();

  const rankingQueries = useQueries({
    queries: ladders.map((ladder) => ladderRankingsOptions(ladder.id)),
  });

  if (laddersQuery.isPending) {
    // THE live region of this screen while it loads, and the only one (invariant #11).
    return (
      <p role="status" className="text-sm text-text-muted">
        Loading the ladders…
      </p>
    );
  }

  if (laddersQuery.isError) {
    return (
      <p role="alert" className="text-sm text-arena-red">
        Could not load the ladders of this game.
      </p>
    );
  }

  if (ladders.length === 0) {
    // A game with no ladder cannot happen today (the nine come from a migration), but a
    // sentence beats an empty space that reads as a broken page.
    return (
      <p className="rounded-control border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
        No ladder is open on this game yet.
      </p>
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-4">
      {ladders.map((ladder, index) => {
        const query = rankingQueries[index];
        const rankings = query?.data?.rankings;
        // Top three CLIENT-SIDE. A `?limit=` server-side would have broken the shared cache
        // entry above — we would pay a request to save one.
        const podium = rankings?.slice(0, PODIUM_SIZE) ?? [];

        // THE FORMAT DECIDES, never the absence of a team.
        const isSolo = ladder.format === '1v1';
        // At most ONE team per ladder (`team_members_user_ladder_unique`), so a `find` is not
        // an arbitrary pick among several.
        const myTeam = myTeams.data?.teams.find((team) => team.ladderId === ladder.id);

        return (
          <GameLadderCard
            key={ladder.id}
            ladder={ladder}
            podium={podium}
            podiumLoaded={Boolean(rankings)}
            podiumFailed={Boolean(query?.isError)}
            standingLabel={standingLabel({
              ladder,
              isSolo,
              meId,
              myTeam,
              myTeamsPending: myTeams.isPending,
              myTeamsFailed: myTeams.isError,
              rankings,
              rankingsFailed: Boolean(query?.isError),
            })}
            action={
              <LadderAction
                ladder={ladder}
                isSolo={isSolo}
                myTeam={myTeam}
                myTeamsPending={myTeams.isPending}
                myTeamsFailed={myTeams.isError}
              />
            }
          />
        );
      })}
    </ul>
  );
}

/** The single action of a card — the whole point of the page: "I want to play this". */
function LadderAction({
  ladder,
  isSolo,
  myTeam,
  myTeamsPending,
  myTeamsFailed,
}: {
  ladder: Ladder;
  isSolo: boolean;
  myTeam: TeamListItem | undefined;
  myTeamsPending: boolean;
  myTeamsFailed: boolean;
}) {
  if (isSolo) {
    return (
      <Link
        to="/solo/$ladderId"
        params={{ ladderId: ladder.id }}
        className={buttonClasses('primary')}
      >
        Play solo
      </Link>
    );
  }

  if (myTeam) {
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: myTeam.id }}
        className={buttonClasses('secondary')}
      >
        My team
      </Link>
    );
  }

  // Nothing at all while the answer is unknown: a button that silently turns into a different
  // one under the cursor is worse than one that arrives a moment later.
  if (myTeamsPending || myTeamsFailed) return null;

  return (
    <Link
      to="/teams"
      // Pre-selects this ladder in the creation form. Without it, someone who just picked a
      // ladder here has to pick it again over there — which is most of this page's value.
      search={{ create: ladder.id }}
      className={buttonClasses('primary')}
    >
      Create a team
    </Link>
  );
}

/** My line on a ladder, in words. */
function standingLabel({
  ladder,
  isSolo,
  meId,
  myTeam,
  myTeamsPending,
  myTeamsFailed,
  rankings,
  rankingsFailed,
}: {
  ladder: Ladder;
  isSolo: boolean;
  meId: string | undefined;
  myTeam: TeamListItem | undefined;
  myTeamsPending: boolean;
  myTeamsFailed: boolean;
  rankings: RankingEntry[] | undefined;
  rankingsFailed: boolean;
}) {
  if (isSolo) {
    if (rankingsFailed) return 'Your standing is unavailable';
    // "unknown", never "not ranked": `meId` is undefined for a frame while the session boots,
    // and claiming "not ranked" then would flash a lie on a ranked account.
    if (!meId || !rankings) return 'Loading your standing…';

    const standing = findUserStanding(rankings, meId);
    return standing ? `You: ${standing.elo} Elo · #${standing.rank}` : 'You are not ranked yet';
  }

  // WHICH TEAM comes before its standing: "you have no team here" stays true even when the
  // board failed to load, and it is the more useful of the two answers.
  if (myTeamsFailed) return 'Your teams could not be loaded';
  if (myTeamsPending) return 'Loading your standing…';
  if (!myTeam) return `You have no team on ${ladder.name}`;
  if (rankingsFailed) return `${myTeam.name}: standing unavailable`;
  if (!rankings) return 'Loading your standing…';

  const standing = findTeamStanding(rankings, myTeam.id);
  return standing
    ? `${myTeam.name}: ${standing.elo} Elo · #${standing.rank}`
    : `${myTeam.name} is not ranked yet`;
}
