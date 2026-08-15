import { useSortedGames } from '@/lib/games';
import { gameHref } from '@/data/games';
import { GameLogo } from './GameLogo';
import { GamesFallback } from './GamesFallback';

export function GamesLogos() {
  const { games, isLoading, isError } = useSortedGames();

  if (isLoading) return <GamesFallback variant="loading" />;
  if (isError) return <GamesFallback variant="error" />;

  return (
    <div className="flex items-center gap-3">
      {games.map((game) => (
        <a
          key={game.id}
          href={gameHref[game.id]}
          aria-label={`${game.name} logo`}
          className="panel focus-ring flex h-40 w-60 shrink-0 cursor-pointer items-center justify-center p-3 transition hover:bg-surface-card"
        >
          <GameLogo
            gameId={game.id}
            name={game.name}
            className="h-full w-full object-contain"
          />
        </a>
      ))}
    </div>
  );
}
