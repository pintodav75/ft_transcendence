import { useQueries } from '@tanstack/react-query';

import { SoloLadderCard } from '@/components/solo/SoloLadderCard';
import { findUserStanding, ladderRankingsOptions } from '@/lib/ladders';
import { useAuthStore } from '@/stores/auth-store';
import { useSoloLadders } from '@/lib/solo';
import { useSortedGames } from '@/lib/games';

/**
 * Self-contained poster grid of the 1v1 ladders with my standing on each. Same shape as
 * TeamsCards: it owns its requests and all three states.
 *
 * one useQueries, NOT a useQuery per tile — the number of 1v1 ladders comes from the data, so
 * a hook per ladder breaks the rules of hooks the day a migration adds a third.
 * options come from ladderRankingsOptions, the same definition useLadderRankings uses, so
 * these land in ['ladder', id, 'rankings'] and opening a tile costs no further request.
 */
export function SoloLadderCards() {
  const { ladders, isPending, isError } = useSoloLadders();
  // Reference data, cached an hour under ['games'] — usually already warm from the rail or
  // another screen, so this rarely refetches.
  const { games } = useSortedGames();
  const gameNameById = new Map(games.map((game) => [game.id, game.name]));
  // Selector form so the grid re-renders on the user, not on every token refresh.
  const meId = useAuthStore((state) => state.user?.id);

  const rankingQueries = useQueries({
    queries: ladders.map((ladder) => ladderRankingsOptions(ladder.id)),
  });

  if (isPending) {
    // THE live region of this screen, and the only one: nothing here mutates, so there is no
    // announcement to make and no second `role="status"` to compete with it (invariant #11).
    return (
      <p role="status" className="text-sm text-text-muted">
        Loading the solo ladders…
      </p>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-arena-red">
        Could not load the solo ladders.
      </p>
    );
  }

  if (ladders.length === 0) {
    // Defensive: the 1v1 ladders are created by a migration, so in practice this is unreachable
    // — which is also why no audit check exercises it.
    return (
      <p className="rounded-control border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
        No solo ladder is open yet.
      </p>
    );
  }

  return (
    // role="list" is redundant on paper, but Safari drops list semantics from a <ul> as soon as
    // it is display:grid — restating it keeps the "list of N ladders" announcement.
    <ul
      role="list"
      // Same track sizing as the teams grid: the tiles are square, so their width IS their
      // height, and `min(18rem,100%)` caps the track floor at the available width so a 320 px
      // phone gets one column instead of a horizontal overflow.
      className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-4"
    >
      {ladders.map((ladder, index) => {
        const query = rankingQueries[index];
        // `meId` can be undefined for a frame while the session boots. Treating that as "not
        // ranked" would flash a wrong claim on a ranked account, so it reads as unknown.
        const standing =
          query?.data && meId ? findUserStanding(query.data.rankings, meId) : undefined;

        const standingLabel = !meId || query?.isPending
          ? 'Loading your standing…'
          : query?.isError
            ? 'Standing unavailable'
            : standing
              ? `${standing.elo} Elo · #${standing.rank}`
              : // Not an error and not a blank: a line is created by a first match RESULT, so this is simply what every account looks like before it has played.
                'Not ranked yet';

        // Repli sur l'ID DU JEU, pas sur le nom du ladder : cette valeur finit dans l'`alt` de
        // l'artwork, et « Chess 1v1 » y décrirait le ladder au lieu du jeu qu'on voit.
        const gameName = gameNameById.get(ladder.gameId) ?? ladder.gameId;

        return (
          <SoloLadderCard
            key={ladder.id}
            ladderId={ladder.id}
            gameId={ladder.gameId}
            gameName={gameName}
            name={ladder.name}
            standingLabel={standingLabel}
          />
        );
      })}
    </ul>
  );
}
