import { createFileRoute } from '@tanstack/react-router';
import { TeamDetail } from '@/pages/teams/team-detail';

export const Route = createFileRoute('/teams/$teamId')({
  component: TeamDetail,
});
