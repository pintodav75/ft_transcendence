import { createFileRoute } from '@tanstack/react-router';

import { History } from '@/pages/history';

export const Route = createFileRoute('/_authenticated/history')({
  component: History,
});
