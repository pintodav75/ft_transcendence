import { createFileRoute } from '@tanstack/react-router';

import { DisputeQueue } from '@/pages/admin/dispute-queue';

export const Route = createFileRoute('/_authenticated/admin/disputes')({
  component: DisputeQueue,
});
