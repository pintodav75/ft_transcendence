import { Link } from '@tanstack/react-router';

import { GamePosterTile, posterTileClasses } from '@/components/games/GamePosterTile';
import { formatsForGame, useLadders, useSortedGames } from '@/lib/games';

/**
 * Poster grid of every game on the platform. Self-contained like TeamsCards and
 * SoloLadderCards: it owns its requests and all three states, so the page stays a layout.
 *
 * no avatar on the tiles — GamePosterTile's emblem slot identifies a competitor, and here it
 * could only carry my own face on every tile. the subtitle carries what actually differs, the
 * formats you can be ranked in.
 * both queries are reference data cached an hour and shared with the rail, /teams and /solo,
 * so this usually paints from cache with no request at all.
 */
export function GamesGrid() {
  const { games, isLoading, isError } = useSortedGames();
  const laddersQuery = useLadders();

  if (isLoading) {
    // THE live region of this screen, and the only one: nothing here mutates, so there is no
    // announcement to make and no second `role="status"` to compete with it (invariant #11).
    return (
      <p role="status" className="text-sm text-text-muted">
        Loading the games…
      </p>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-arena-red">
        Could not load the games.
      </p>
    );
  }

  if (games.length === 0) {
    // Defensive: the five games are created by a migration, so this is unreachable in practice.
    // Rendering a sentence rather than nothing keeps the page from looking broken.
    return (
      <p className="rounded-control border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
        No game is open yet.
      </p>
    );
  }

  return (
    // `role="list"` is redundant on paper, but Safari drops list semantics from a <ul> as soon
    // as it is display:grid — restating it keeps the "list of N games" announcement.
    <ul
      role="list"
      // Same track sizing as the teams and solo grids: the tiles are square, so their width IS
      // their height, and `min(18rem,100%)` caps the track floor at the available width so a
      // 320 px phone gets one column instead of a horizontal overflow.
      className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-4"
    >
      {games.map((game) => {
        const formats = laddersQuery.data
          ? formatsForGame(laddersQuery.data.ladders, game.id)
          : [];

        // A missing subtitle and a failed request must not look alike: the tile stays clickable
        // either way, but it never claims "no ladder" on a request that failed.
        const subtitle = laddersQuery.isPending
          ? 'Loading formats…'
          : laddersQuery.isError
            ? 'Formats unavailable'
            : formats.length > 0
              ? formats.join(' · ')
              : 'No ladder yet';

        return (
          <li key={game.id}>

            <Link to="/games/$gameId" params={{ gameId: game.id }} className={posterTileClasses}>
              <GamePosterTile
                gameId={game.id}
                gameName={game.name}
                title={game.name}
                subtitle={subtitle}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
