import { Link } from '@tanstack/react-router';

import { GamePosterTile, posterTileClasses } from '@/components/games/GamePosterTile';

type SoloLadderCardProps = {
  ladderId: string;
  gameId: string;
  /** Display name of the game, resolved by the caller — the artwork's accessible name. */
  gameName: string;
  /** The ladder's own name ("Chess 1v1"). */
  name: string;
  /** My line on it, or why there is none — computed by the caller, which owns the query. */
  standingLabel: string;
};

/**
 * One 1v1 ladder, one poster: the whole tile is a single link to `/solo/$ladderId`.
 *
 * ⚠️ NO AVATAR, unlike `TeamCard`. The emblem slot of `GamePosterTile` exists to identify the
 * competitor, and on this grid every tile would carry MY face — which says nothing about the
 * ladder it sits on. The line that matters is the standing, and it is already there.
 *
 * 🚨 THE TILE EXISTS EVEN WHEN I HAVE NO STANDING, and that is the whole point of the screen.
 * A solo ladder is not something you JOIN: a `rankings` row is born of the first match result.
 * Listing only the ladders I am ranked on would greet a new account with an empty page and no
 * way in — so the grid lists the ladders that EXIST and this tile says "Not ranked yet".
 */
export function SoloLadderCard({
  ladderId,
  gameId,
  gameName,
  name,
  standingLabel,
}: SoloLadderCardProps) {
  return (
    <li>
      <Link to="/solo/$ladderId" params={{ ladderId }} className={posterTileClasses}>
        <GamePosterTile
          gameId={gameId}
          gameName={gameName}
          title={name}
          subtitle={standingLabel}
        />
      </Link>
    </li>
  );
}
