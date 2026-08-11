import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { GameBanner } from '@/components/games/GameBanner';
import { GameLadderCards } from '@/components/games/GameLadderCards';
import { LadderMapPool } from '@/components/ladders/LadderMapPool';
import { ErrorPanel } from '@/components/ui/error-panel';
import { SectionTitle } from '@/components/ui/section-title';
import { backLinkClasses } from '@/lib/back-navigation';
import { buttonClasses } from '@/components/ui/button-variants';
import { providerLabel, useGameDetail, useLadders, useSortedGames } from '@/lib/games';

/**
 * The way back up, in the two shapes this page needs: the discreet link above the panel, and
 * the way out of a dead end (`ErrorPanel`), where it is the only control on screen and has to
 * look like one.
 */
function BackToGames({ variant = 'inline' }: { variant?: 'inline' | 'button' }) {
  const inline = variant === 'inline';

  return (
    <Link to="/games" className={inline ? backLinkClasses : buttonClasses('secondary')}>
      <ArrowLeft aria-hidden="true" className={inline ? 'size-4' : 'mr-2 size-4'} />
      {inline ? 'Games' : 'Back to the games'}
    </Link>
  );
}

/** `/games/$gameId` — one game: what it needs from you, what it is played on, and its ladders. */
export function GameDetail() {
  const { gameId } = useParams({ from: '/_authenticated/games/$gameId' });

  const { games, isLoading, isError } = useSortedGames();
  // Reference data, same cached `GET /ladders` the cards below read: this costs nothing and
  // lets the header state how many ladders the game carries.
  const laddersQuery = useLadders();

  const game = games.find((entry) => entry.id === gameId);

  // ONLY for the map pool, and only once the slug is known to exist. Its failure must not take
  // the page down with it: the pool disappears, nothing else.
  const detailQuery = useGameDetail(gameId, Boolean(game));

  if (isError) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Games unavailable"
          message="The list of games could not be loaded. Check your connection and reload the page."
        >
          <BackToGames variant="button" />
        </ErrorPanel>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <BackToGames />
        {/* Same footprint as the loaded header so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        {/* THE live region of this screen while it loads — there must only ever be one. */}
        <p role="status" className="text-sm text-text-muted">
          Loading the game…
        </p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Game not found"
          message="No game answers to this link. Games are seeded with the platform, so this one has most likely never existed."
        >
          <BackToGames variant="button" />
        </ErrorPanel>
      </div>
    );
  }

  const ladderCount = laddersQuery.data?.ladders.filter(
    (ladder) => ladder.gameId === game.id,
  ).length;
  // An empty pool is NOT an error: only cs2 and val have maps. A failed request leaves it
  // undefined, and the section simply does not render.
  const maps = detailQuery.data?.maps ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <BackToGames />

      <div className="panel flex min-w-0 flex-col gap-8 p-6">
        <header className="space-y-1">

          <GameBanner gameId={game.id} name={game.name} className="-mx-6 -mt-6 mb-4 h-32 sm:h-36" />
          <p className="flex items-center gap-2 text-xs label-caps text-success">
            <Gamepad2 aria-hidden="true" className="size-4" /> Game
          </p>
          <h1 className="text-3xl label-caps-black">{game.name}</h1>
          <p className="flex flex-wrap items-center gap-2 pt-1 text-xs label-caps text-text-secondary">
            {/* Silent while the ladders load: "0 ladders" would be a claim, not a placeholder. */}
            {ladderCount !== undefined && (
              <>
                <span>
                  {ladderCount} {ladderCount === 1 ? 'ladder' : 'ladders'}
                </span>

                <span aria-hidden="true">·</span>
              </>
            )}

            <span>Requires a linked {providerLabel(game.requiredProvider)} account</span>
          </p>
        </header>

        {maps.length > 0 && <LadderMapPool maps={maps} gameName={game.name} />}

        <section className="flex min-w-0 flex-col gap-3.5">
          <SectionTitle>Ladders</SectionTitle>

          <GameLadderCards gameId={game.id} />
        </section>
      </div>
    </div>
  );
}
