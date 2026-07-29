import { GameImage } from '@/components/games/GameImage';
import { cn } from '@/lib/utils';

type GameBannerProps = {
  gameId: string;
  name: string;
  /** Height and bleed of the strip, decided by the caller (`-mx-6 h-32 sm:h-36`…). */
  className?: string;
};

/**
 * The game's artwork as a header strip, with the bottom-to-top readability gradient every
 * "dossier" header uses.
 *
 * Extracted at its second reader (the ladder page, then the match sheet — FT-4A): the two
 * were carrying the same three lines, including the exact gradient stops.
 *
 * `aria-hidden` is baked in on purpose: every caller writes the game's name in full just
 * below, so the strip is decoration. A screen reader announcing "Counter-Strike 2 image"
 * right before the heading that says "Counter-Strike 2" is noise, not information.
 */
export function GameBanner({ gameId, name, className }: GameBannerProps) {
  return (
    <div aria-hidden="true" className={cn('relative overflow-hidden', className)}>
      <GameImage gameId={gameId} name={name} className="size-full object-cover" />
      <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
    </div>
  );
}
