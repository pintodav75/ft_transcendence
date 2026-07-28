import { createFileRoute } from '@tanstack/react-router';

import { Matchmaking } from '@/pages/matchmaking';

export const Route = createFileRoute('/_authenticated/matchmaking')({
  component: Matchmaking,
});
