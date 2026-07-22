import { createFileRoute } from '@tanstack/react-router';
import { TeamDetail } from '@/pages/teams/team-detail';

export const Route = createFileRoute('/_authenticated/teams/$teamId')({
  component: TeamDetail,
});
