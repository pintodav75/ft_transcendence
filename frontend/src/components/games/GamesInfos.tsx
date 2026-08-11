import { useSortedGames, useLadders, formatsForGame } from '@/lib/games';
import { GameInfo } from './GameInfo';
import { GamesFallback } from './GamesFallback';

// Test/preview component: renders a GameInfo for every game so the overlay content can be
// eyeballed on the page.
export function GamesInfos() {
  const { games, isLoading, isError } = useSortedGames();
  const ladders = useLadders();

  if (isLoading || ladders.isLoading) return <GamesFallback variant="loading" />;
  if (isError || !ladders.data) return <GamesFallback variant="error" />;

  return (
    <div className="flex flex-wrap justify-evenly gap-4">
      {games.map((game) => (
        <div
          key={game.id}
          className="panel aspect-square w-[300px] shrink-0 overflow-hidden"
        >
          <GameInfo
            game={game}
            formats={formatsForGame(ladders.data.ladders, game.id)}
          />
        </div>
      ))}
    </div>
  );
}
