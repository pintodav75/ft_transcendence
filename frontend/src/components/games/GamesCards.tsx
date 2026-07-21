import { useId } from 'react';
import { Info } from 'lucide-react';
import { useSortedGames, useLadders, formatsForGame } from '@/lib/games';
import { GameImage } from './GameImage';
import { GameInfo } from './GameInfo';
import { GamesFallback } from './GamesFallback';

export function GamesCards() {
  const { games, isLoading, isError } = useSortedGames();
  const ladders = useLadders();
  // Generated rather than hardcoded: an id must stay unique even if this
  // section is ever rendered more than once on a page.
  const headingId = useId();

  if (isLoading || ladders.isLoading) return <GamesFallback variant="loading" />;
  if (isError || !ladders.data) return <GamesFallback variant="error" />;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-4 text-2xl font-black uppercase leading-none text-success"
      >
        Choose your arena
      </h2>

      {/* role="list" is redundant on paper, but Safari drops list semantics
          from a <ul> as soon as it is display:flex — restating it keeps the
          "list of N games" announcement. */}
      <ul role="list" className="flex flex-wrap justify-evenly gap-4">
        {games.map((game) => (
          // group + focusable card: the info overlay reveals on hover (mouse)
          // and on keyboard focus (group-focus-within), so it stays accessible.
          <li
            key={game.id}
            tabIndex={0}
            aria-label={game.name}
            className="group panel focus-ring relative w-[300px] shrink-0 overflow-hidden"
          >
            <GameImage
              gameId={game.id}
              name={game.name}
              className="aspect-square w-full object-cover"
            />

            {/* affordance badge: fades out once the info takes over */}
            <span className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1.5 text-white transition group-hover:opacity-0 group-focus-within:opacity-0">
              <Info className="size-6" />
            </span>

            {/* info overlay: hidden at rest, revealed on hover/focus */}
            <div className="absolute inset-0 bg-surface-card opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <GameInfo
                game={game}
                formats={formatsForGame(ladders.data.ladders, game.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
