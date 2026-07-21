type GameAssetProps = {
  src?: string;
  name: string;
  kind: string;
  className?: string;
};

// Shared renderer for a game's visual asset (logo / icon / image): renders the
// image, or a text fallback if the asset is missing for that game. GameLogo,
// GameIcon and GameImage are thin wrappers that pass the right asset + kind.
export function GameAsset({ src, name, kind, className }: GameAssetProps) {
  if (!src) {
    return <span className={className}>{name} — missing {kind}</span>;
  }

  return <img src={src} alt={`${name} ${kind}`} className={className} />;
}
