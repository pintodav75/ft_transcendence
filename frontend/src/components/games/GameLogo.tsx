import { gameLogos } from '@/data/games';
import { GameAsset } from './GameAsset';

type GameLogoProps = {
  gameId: string;
  name: string;
  className?: string;
};

export function GameLogo({ gameId, name, className }: GameLogoProps) {
  return <GameAsset src={gameLogos[gameId]} name={name} kind="logo" className={className} />;
}
