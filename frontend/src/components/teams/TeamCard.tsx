import { Crown } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { GamePosterTile, posterTileClasses } from '@/components/games/GamePosterTile';

import type { TeamListItem } from '@/lib/teams';

type TeamCardProps = {
  team: TeamListItem;
  // Display name of team.gameId, resolved by the caller (TeamsCards) from useSortedGames() —
  // used as the artwork's accessible name.
  gameName: string;
};

// One team, one poster: the whole tile is a single link to the team's detail page — this screen
// exists only to pick a team, no stats belong here.
export function TeamCard({ team, gameName }: TeamCardProps) {
  return (
    <li>
      <Link to="/teams/$teamId" params={{ teamId: team.id }} className={posterTileClasses}>
        <GamePosterTile
          gameId={team.gameId}
          gameName={gameName}
          title={team.name}
          subtitle={team.ladder}
          avatar={{
            src: team.logoUrl ?? undefined,
            fallback: team.name.slice(0, 2).toUpperCase(),
          }}
          badge={
            team.isCaptain ? (
              <Crown role="img" aria-label="You are the captain" className="size-4 text-rank-gold" />
            ) : null
          }
        />
      </Link>
    </li>
  );
}
