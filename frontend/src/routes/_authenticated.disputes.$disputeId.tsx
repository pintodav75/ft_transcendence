import { createFileRoute } from '@tanstack/react-router';

import { DisputeDetail } from '@/pages/disputes/dispute-detail';

export const Route = createFileRoute('/_authenticated/disputes/$disputeId')({
  component: DisputeDetail,
});
