import { TeamCard } from '@/components/teams/TeamCard';
import { useSortedGames } from '@/lib/games';
import { useMyTeams } from '@/lib/teams';

type TeamsCardsProps = {
  // '' (All) and undefined both mean "no filter" — show every team.
  gameFilter?: string;
};

// Self-contained "poster grid" of the caller's teams: owns the single GET
// /teams call and all three states (loading / error / empty), same shape as
// GamesCards for the game collection.
export function TeamsCards({ gameFilter }: TeamsCardsProps) {
  const { data, isLoading, isError } = useMyTeams();
  // Reference data, cached an hour under ['games'] — often already warm from
  // the LadderSelect filter above or the games page, so this rarely refetches.
  const { games } = useSortedGames();
  const gameNameById = new Map(games.map((game) => [game.id, game.name]));

  if (isLoading) {
    return (
      <p role="status" className="text-sm text-text-muted">
        Loading your teams…
      </p>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-arena-red">
        Could not load your teams.
      </p>
    );
  }

  const shown = gameFilter ? data.teams.filter((team) => team.gameId === gameFilter) : data.teams;

  if (shown.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
        {/* A game filter narrowing an existing roster to nothing is a different
            situation from having no team at all — say so instead of lying. */}
        {data.teams.length === 0 ? "You're not part of any team." : 'No team on this game.'}
      </p>
    );
  }

  // GET /teams orders by name alone, which scatters two teams of the same game
  // across the grid — and since the tile *is* the game artwork, two identical
  // posters far apart read as a duplicate rather than as a pair. Group by game
  // first, alphabetically within a game. Purely presentational, so it belongs
  // here and not in the API: the endpoint returns every team of the caller, so
  // there is no pagination this could reorder across.
  const ordered = [...shown].sort(
    (a, b) =>
      // Falls back to the id so the grouping still holds while ['games'] loads
      // — the group order is arbitrary for that frame, the grouping is not.
      (gameNameById.get(a.gameId) ?? a.gameId).localeCompare(
        gameNameById.get(b.gameId) ?? b.gameId,
      ) || a.name.localeCompare(b.name),
  );

  return (
    // role="list" is redundant on paper, but Safari drops list semantics from
    // a <ul> as soon as it is display:grid — restating it keeps the "list of
    // N teams" announcement (same idiom as GamesCards).
    <ul
      role="list"
      // 18rem, not 22rem: the tiles are square, so their width IS their height.
      // A narrower minimum fits one more column and brings each tile back to the
      // height it had when it was a 22rem-wide 4/3 rectangle.
      // min(18rem,100%), not 18rem: below 288px of grid area — a 320px phone
      // minus the layout and panel padding leaves 240px — a bare minmax minimum
      // is a floor the track cannot go under, and the grid overflows the page.
      // min() caps that floor at the available width, which forces one column.
      className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-4"
    >
      {ordered.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          gameName={gameNameById.get(team.gameId) ?? team.name}
        />
      ))}
    </ul>
  );
}
