import { createFileRoute } from '@tanstack/react-router';
import { TeamsLayout } from '@/pages/teams/route';

export const Route = createFileRoute('/teams')({
  component: TeamsLayout,
});
