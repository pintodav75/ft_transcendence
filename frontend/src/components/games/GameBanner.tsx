import { GameImage } from '@/components/games/GameImage';
import { cn } from '@/lib/utils';

type GameBannerProps = {
  gameId: string;
  name: string;
  /** Height and bleed of the strip, decided by the caller (`-mx-6 h-32 sm:h-36`…). */
  className?: string;
};

export function GameBanner({ gameId, name, className }: GameBannerProps) {
  return (
    <div aria-hidden="true" className={cn('relative overflow-hidden', className)}>
      <GameImage gameId={gameId} name={name} className="size-full object-cover" />
      <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
    </div>
  );
}
