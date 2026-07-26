import { Crown } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { GameImage } from '@/components/games/GameImage';
import { Avatar } from '@/components/ui/avatar';

import type { TeamListItem } from '@/lib/teams';

type TeamCardProps = {
  team: TeamListItem;
  // Display name of team.gameId, resolved by the caller (TeamsCards) from
  // useSortedGames() — used as the artwork's accessible name.
  gameName: string;
};

// One team, one poster: the whole tile is a single link to the team's detail
// page — this screen exists only to pick a team, no stats belong here.
export function TeamCard({ team, gameName }: TeamCardProps) {
  return (
    <li>
      <Link
        to="/teams/$teamId"
        params={{ teamId: team.id }}
        className="group focus-ring relative block aspect-square overflow-hidden rounded-card border border-border-subtle"
      >
        {/*
          Square on purpose: every game asset is a 512x512 square. Any other
          ratio either crops into the artwork's logotype (4/3 cut the top off
          Rocket League and Counter-Strike) or letterboxes it. Matching the
          source ratio is the only framing that shows them whole, full-bleed and
          undistorted — same choice as GamesCards.
        */}
        <GameImage
          gameId={team.gameId}
          name={gameName}
          className="size-full object-cover transition duration-300 group-hover:scale-105"
        />

        {/* Readability gradient over the artwork, bottom to top. */}
        <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/60 to-transparent" />

        {team.isCaptain && (
          <span className="absolute right-3 top-3 rounded-full bg-background-app/60 p-1.5">
            <Crown role="img" aria-label="You are the captain" className="size-4 text-rank-gold" />
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-4">
          <Avatar
            src={team.logoUrl ?? undefined}
            alt=""
            fallback={team.name.slice(0, 2).toUpperCase()}
            className="size-11 shrink-0 ring-1 ring-border-subtle"
          />

          <div className="min-w-0">
            <p className="truncate text-lg label-caps-black text-text-primary">{team.name}</p>
            <p className="truncate text-xs label-caps text-text-secondary">{team.ladder}</p>
          </div>
        </div>
      </Link>
    </li>
  );
}
