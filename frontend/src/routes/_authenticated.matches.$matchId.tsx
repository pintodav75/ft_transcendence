import { createFileRoute } from '@tanstack/react-router';

import { MatchDetail } from '@/pages/matches/match-detail';

export const Route = createFileRoute('/_authenticated/matches/$matchId')({
  component: MatchDetail,
});
