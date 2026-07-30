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

/**
 * Every ladder of one game, each with its podium, my line on it and the way in.
 *
 * 🔑 THE PERF POINT OF THE TICKET — ONE `useQueries`, NEVER a `useQuery` per card. The number
 * of ladders comes from the DATA (one for chess, two for cs2, three for rl), so a hook per
 * card would break the rules of hooks the day a migration adds one. And the options come from
 * `ladderRankingsOptions`, the shared definition: the responses land in
 * `['ladder', id, 'rankings']` — the very key `/ladders/$ladderId` reads — so following "See
 * the full standings" costs NO further request.
 *
 * The ladders themselves are filtered CLIENT-SIDE out of the cached `GET /ladders`: the nine
 * of them are already in memory (rail, `/teams`, `/solo`), so `?gameId=` would be a request
 * for nothing.
 */
/**
 * Team size of a format, read FROM the format (`1v1` -> 1, `5v5` -> 5) — never from a list of
 * the four that exist today. A migration adding `4v4` must sort itself.
 *
 * An unparsable format sorts LAST (see the descending order below), so a format nobody
 * anticipated cannot end up leading the page.
 */
function teamSize(format: string) {
  const size = Number.parseInt(format, 10);
  return Number.isNaN(size) ? -1 : size;
}

export function GameLadderCards({ gameId }: { gameId: string }) {
  const laddersQuery = useLadders();
  const ladders = (laddersQuery.data?.ladders ?? [])
    .filter((ladder) => ladder.gameId === gameId)
    // ⚠️ `GET /ladders` sorts BY NAME, which put "Counter-Strike 2 2v2 (Wingman)" — empty —
    // ahead of the 5v5 that carries every ranked team: the page opened on its dead card.
    //
    // 🔑 BIGGEST FORMAT FIRST, because across all nine seeded ladders the largest format IS the
    // canonical one (cs2 5v5, valorant 5v5, Rocket League 3v3), and the smaller ones are the
    // side modes. Deliberately NOT sorted by number of ranked competitors: that would reshuffle
    // the cards under the cursor as the standings land, and would hang the page's order on a
    // request that can fail.
    //
    // ⚠️ Sorting in place is safe ONLY because `filter` above already returned a NEW array —
    // the one held by the React Query cache is never reordered under it.
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

        // 🚨 THE FORMAT DECIDES, never the absence of a team.
        const isSolo = ladder.format === '1v1';
        // ⚠️ At most ONE team per ladder (`team_members_user_ladder_unique`), so a `find` is
        // not an arbitrary pick among several.
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

/**
 * The single action of a card — the whole point of the page: "I want to play this".
 *
 * 🚨 PILOTED BY `ladder.format`, AND BY NOTHING ELSE. Reading "no team" as "solo" is the bug
 * this codebase has already fixed twice (FT-4A, F-SOLO): a 5v5 ladder where I have no team
 * offers team creation, never a solo slot the API would refuse.
 */
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
  //
  // ⚠️ A FAILED `GET /teams` IS ALSO "UNKNOWN", not "no team". Without this, a network blip
  // offers "Create a team" to someone who already has one on this ladder: the form opens
  // pre-filled and the POST is refused by `team_members_user_ladder_unique`. This page's own
  // rule is that no button may be shown which the API would reject — and `standingLabel` is
  // already honest here ("Your teams could not be loaded"), so only the button was lying.
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

/**
 * My line on a ladder, in words.
 *
 * 🚨 `undefined` IS THE NORMAL STATE, NOT AN ERROR: a `rankings` row is born of the first
 * match RESULT, never of an enrolment. Hence "Not ranked yet" and never a fabricated Elo.
 *
 * ⚠️ And "unknown" is not "not ranked": `meId` is undefined for a frame while the session
 * boots, and `GET /teams` may still be in flight. Saying "not ranked" then would flash a
 * wrong claim on a ranked account.
 */
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
    // ⚠️ "unknown", never "not ranked": `meId` is undefined for a frame while the session
    // boots, and claiming "not ranked" then would flash a lie on a ranked account.
    if (!meId || !rankings) return 'Loading your standing…';

    const standing = findUserStanding(rankings, meId);
    return standing ? `You: ${standing.elo} Elo · #${standing.rank}` : 'You are not ranked yet';
  }

  // ⚠️ WHICH TEAM comes before its standing: "you have no team here" stays true even when the
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
