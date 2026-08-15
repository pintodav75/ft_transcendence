import { useSortedGames } from '@/lib/games';
import { gameHref } from '@/data/games';
import { GameIcon } from './GameIcon';
import { GamesFallback } from './GamesFallback';

export function GamesIcons() {
  const { games, isLoading, isError } = useSortedGames();

  if (isLoading) return <GamesFallback variant="loading" />;
  if (isError) return <GamesFallback variant="error" />;

  return (
    <div className="flex items-center gap-3">
      {games.map((game) => (
        // remplacer <a> par <Link> lorsque les routes vers les jeux definies pour eviter les
        // rechargements de page
        <a
          key={game.id}
          href={gameHref[game.id]}
          aria-label={`${game.name} icon`}
          className="panel focus-ring flex aspect-square w-20 shrink-0 cursor-pointer items-center justify-center p-3 transition hover:bg-surface-card"
        >
          <GameIcon
            gameId={game.id}
            name={game.name}
            className="h-full w-full object-contain"
          />
        </a>
      ))}
    </div>
  );
}