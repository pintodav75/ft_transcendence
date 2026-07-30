import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Matchmaking } from '@/pages/matchmaking';

/**
 * `?ladderId=<uuid>` — restricts the board to one ladder, so `/ladders/$ladderId`, a team page
 * or `/solo/$ladderId` can send someone here already filtered. (Posting those links is out of
 * [F-MM]'s scope; the page only has to be able to READ the parameter.)
 *
 * ⚠️ `.catch(undefined)` is what makes a malformed value **ignored in silence** instead of
 * blowing the route up over a query string anyone can mistype — same shape as `?create=` on
 * `/teams`. Being a uuid is only the SHAPE: the page then checks that the ladder EXISTS against
 * the cached `GET /ladders`, because `GET /matches` answers 404 on an unknown one and a 404
 * writes a red line in the Chrome console.
 */
const matchmakingSearchSchema = z.object({
  ladderId: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_authenticated/matchmaking')({
  component: Matchmaking,
  validateSearch: (search) => matchmakingSearchSchema.parse(search),
});
