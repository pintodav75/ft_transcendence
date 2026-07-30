import { GameImage } from '@/components/games/GameImage';
import { Avatar } from '@/components/ui/avatar';

import type { ReactNode } from 'react';

/**
 * The square "poster" tile of a picker grid: the game's artwork full-bleed, a readability
 * gradient, an optional corner badge, and an identity strip along the bottom.
 *
 * Extracted from `TeamCard` at its second reader — [F-SOLO]'s `/solo` grid, which the card
 * asked for "au gabarit `TeamCard`" while forbidding a copy of its classes. `TeamCard` is now
 * an adapter over this, so the two grids cannot drift.
 *
 * ⚠️ THIS COMPONENT DOES NOT RENDER THE LINK, and that is deliberate. The two grids point at
 * different routes with different params, and TanStack Router types `to`/`params` as a pair —
 * funnelling them through a generic `href` prop would throw away exactly the type-safety that
 * makes a broken link a compile error. The caller owns its `<Link>` and puts
 * `posterTileClasses` on it; the `group-hover` below hangs off that class.
 */
export const posterTileClasses =
  'group focus-ring relative block aspect-square overflow-hidden rounded-card border border-border-subtle';

type GamePosterTileProps = {
  gameId: string;
  /** Display name of the game — the artwork's accessible name, resolved by the caller. */
  gameName: string;
  title: string;
  subtitle: string;
  /**
   * Small round emblem left of the title (a team's logo). Left out entirely on a grid where
   * it would carry no information: a solo ladder tile would only ever show MY avatar, on
   * every tile, which says nothing about the ladder.
   */
  avatar?: { src?: string; fallback: string };
  /** Corner marker, top right (the captain's crown). */
  badge?: ReactNode;
};

export function GamePosterTile({
  gameId,
  gameName,
  title,
  subtitle,
  avatar,
  badge,
}: GamePosterTileProps) {
  return (
    <>
      {/*
        Square on purpose: every game asset is a 512x512 square. Any other ratio either
        crops into the artwork's logotype (4/3 cut the top off Rocket League and
        Counter-Strike) or letterboxes it. Matching the source ratio is the only framing
        that shows them whole, full-bleed and undistorted — same choice as GamesCards.
      */}
      <GameImage
        gameId={gameId}
        name={gameName}
        className="size-full object-cover transition duration-300 group-hover:scale-105"
      />

      {/* Readability gradient over the artwork, bottom to top. */}
      <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/60 to-transparent" />

      {badge && <span className="absolute right-3 top-3 rounded-full bg-background-app/60 p-1.5">{badge}</span>}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-4">
        {avatar && (
          <Avatar
            src={avatar.src}
            alt=""
            fallback={avatar.fallback}
            className="size-11 shrink-0 ring-1 ring-border-subtle"
          />
        )}

        <div className="min-w-0">
          <p className="truncate text-lg label-caps-black text-text-primary">{title}</p>
          <p className="truncate text-xs label-caps text-text-secondary">{subtitle}</p>
        </div>
      </div>
    </>
  );
}
