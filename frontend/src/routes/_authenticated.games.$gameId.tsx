import { createFileRoute } from '@tanstack/react-router';

import { GameDetail } from '@/pages/games/game-detail';

export const Route = createFileRoute('/_authenticated/games/$gameId')({
  component: GameDetail,
});
