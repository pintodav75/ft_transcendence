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

/**
 * `/games/$gameId` — one game: what it needs from you, what it is played on, and its ladders.
 *
 * The middle step of the path `/games` → `/games/$gameId` → `/ladders/$ladderId`. Everything
 * about a LADDER in full (rules, whole standings) belongs to the last one, which already
 * exists (FT-3): here a ladder is a card with a podium whose job is to make you click.
 *
 * 🔑 THE SLUG IS RESOLVED FROM THE CACHED GAME LIST, NOT FROM `GET /games/{id}`. `games.id` is
 * a text slug, so there is no local shape to validate it against — but the list of the five
 * that exist is already in memory, cached for an hour. An unknown slug therefore renders its
 * error state WITHOUT spending a request, hence without the red "Failed to load resource" line
 * a 404 would leave in the Chrome console — a project-rejection criterion. Same discipline as
 * `isValidLadderId` on the ladder page.
 */
export function GameDetail() {
  const { gameId } = useParams({ from: '/_authenticated/games/$gameId' });

  const { games, isLoading, isError } = useSortedGames();
  // Reference data, same cached `GET /ladders` the cards below read: this costs nothing and
  // lets the header state how many ladders the game carries.
  const laddersQuery = useLadders();

  const game = games.find((entry) => entry.id === gameId);

  // ⚠️ ONLY for the map pool, and only once the slug is known to exist. Its failure must not
  // take the page down with it: the pool disappears, nothing else.
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
          {/* Same idiom as the ladder page and the match sheet: artwork strip with the
              bottom-to-top readability gradient, bled to the panel's edges. */}
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
                {/* Two facts separated by a space alone read as one sentence
                    ("2 LADDERS REQUIRES A LINKED STEAM ACCOUNT"). `aria-hidden` because it is
                    punctuation: the two spans are already separate to a screen reader.
                    ⚠️ Rendered WITH the count, so a failed `GET /ladders` never leaves a
                    dangling separator in front of the provider. */}
                <span aria-hidden="true">·</span>
              </>
            )}
            {/* INFORMATION, not an action: linking an account has no screen yet ([F4B]), and a
                button pointing at a route with nowhere to land would be dead code. */}
            <span>Requires a linked {providerLabel(game.requiredProvider)} account</span>
          </p>
        </header>

        {/* 🔑 The pool belongs to the GAME (`game_maps` is keyed on `games.id`), which is why
            it is shown ONCE here instead of being repeated on each of the game's ladder
            cards. Hidden entirely when empty — lol, rl and chess simply have no maps. */}
        {maps.length > 0 && <LadderMapPool maps={maps} gameName={game.name} />}

        <section className="flex min-w-0 flex-col gap-3.5">
          <SectionTitle>Ladders</SectionTitle>
          {/* Owns the standings requests (one `useQueries` for the whole game) and its three
              states. */}
          <GameLadderCards gameId={game.id} />
        </section>
      </div>
    </div>
  );
}
