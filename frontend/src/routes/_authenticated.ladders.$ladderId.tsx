import { createFileRoute } from '@tanstack/react-router';

import { LadderDetail } from '@/pages/ladders/ladder-detail';

export const Route = createFileRoute('/_authenticated/ladders/$ladderId')({
  component: LadderDetail,
});
