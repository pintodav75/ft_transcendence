import { createFileRoute } from '@tanstack/react-router';

import Ranking from '@/pages/ranking';

export const Route = createFileRoute('/_authenticated/ranking')({
  component: Ranking,
});
