import { createFileRoute } from '@tanstack/react-router';

import { PlayerDetail } from '@/pages/players/player-detail';

export const Route = createFileRoute('/_authenticated/players/$pseudo')({
  component: PlayerDetail,
});
