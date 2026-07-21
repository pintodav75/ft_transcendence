import { gameImages } from '@/data/games';
import { GameAsset } from './GameAsset';

type GameImageProps = {
  gameId: string;
  name: string;
  className?: string;
};

export function GameImage({ gameId, name, className }: GameImageProps) {
  return <GameAsset src={gameImages[gameId]} name={name} kind="image" className={className} />;
}
