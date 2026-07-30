import { createFileRoute } from '@tanstack/react-router';

import { SoloLadder } from '@/pages/solo/solo-ladder';

export const Route = createFileRoute('/_authenticated/solo/$ladderId')({
  component: SoloLadder,
});
