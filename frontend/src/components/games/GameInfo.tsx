import type { Game } from '@/lib/games';
import { GameLogo } from './GameLogo';

type GameInfoProps = {
  game: Game;
  formats: string[];
  playerCount?: number;
};

// Presentational overlay content for a game card: logo on top, then the ranking formats and the
// registered player count grouped at the bottom.
export function GameInfo({ game, formats, playerCount }: GameInfoProps) {
  return (
    <div className="flex h-full flex-col items-center justify-between gap-4 p-4 pt-8 text-center">
      <GameLogo gameId={game.id} name={game.name} className="h-24 w-full object-contain" />

      <div className="flex w-full flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2">
          {formats.map((format) => (
            <span
              key={format}
              className="rounded-control border border-border-subtle px-4 py-2 text-base label-caps text-text-secondary"
            >
              {format}
            </span>
          ))}
        </div>

        <p className="text-sm text-text-secondary">
          {playerCount != null ? `${playerCount} players` : '—'}
        </p>
      </div>
    </div>
  );
}
