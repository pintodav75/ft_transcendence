import { gameIcons } from '@/data/games';
import { GameAsset } from './GameAsset';

type GameIconProps = {
  gameId: string;
  name: string;
  className?: string;
};

export function GameIcon({ gameId, name, className }: GameIconProps) {
  return <GameAsset src={gameIcons[gameId]} name={name} kind="icon" className={className} />;
}
