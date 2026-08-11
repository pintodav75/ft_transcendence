import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Teams } from '@/pages/teams';

/**
 * `?create=<ladderId>` — opens the creation form with that ladder already picked, so someone
 * arriving from `/games/$gameId` does not have to choose the ladder he has just chosen.
 *
 * `.catch(undefined)` is what makes a malformed value **ignored in silence**: a search
 * validation that threw would blow the route up over a query string anyone can mistype. And
 * being a uuid is only the shape — the page still checks that the ladder EXISTS (against the
 * cached `GET /ladders`) before opening anything.
 */
const teamsSearchSchema = z.object({
  create: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_authenticated/teams/')({
  component: Teams,
  validateSearch: (search) => teamsSearchSchema.parse(search),
});
