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

/** One 1v1 ladder, one poster: the whole tile is a single link to `/solo/$ladderId`. */
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
