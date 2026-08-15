import { cn } from '@/lib/utils';

type GameAssetProps = {
  src?: string;
  name: string;
  kind: string;
  className?: string;
};

// Shared renderer for a game's visual asset (logo / icon / image): renders the image, or a
// neutral placeholder if the asset is missing for that game.
export function GameAsset({ src, name, kind, className }: GameAssetProps) {
  if (!src) {
    // A missing asset is our problem, not the visitor's: show the game's name on a neutral
    // surface (same idiom as Avatar's fallback), keeping the caller's footprint so the layout
    // doesn't shift.
    return (
      <div
        role="img"
        aria-label={name}
        className={cn(
          'flex items-center justify-center bg-surface-card-strong px-2 text-center text-text-secondary',
          className,
        )}
      >
        <span className="text-xs label-caps">{name}</span>
      </div>
    );
  }

  return <img src={src} alt={`${name} ${kind}`} className={className} />;
}
