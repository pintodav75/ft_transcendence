import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Matchmaking } from '@/pages/matchmaking';

const matchmakingSearchSchema = z.object({
  ladderId: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_authenticated/matchmaking')({
  component: Matchmaking,
  validateSearch: (search) => matchmakingSearchSchema.parse(search),
});
