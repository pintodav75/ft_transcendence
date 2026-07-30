import { createFileRoute } from '@tanstack/react-router';

import { Solo } from '@/pages/solo';

export const Route = createFileRoute('/_authenticated/solo/')({
  component: Solo,
});
