import { useQuery } from '@tanstack/react-query';

import { apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

type BlocksResponse = paths['/blocks']['get']['responses'][200]['content']['application/json'];

/**
 * One account I have blocked.
 *
 * 🔑 `id` IS THE PERSON — there is no relation id here, because `DELETE /blocks/{userId}` takes
 * the account. This is the exact mirror of the `Friend` trap and it is worth saying out loud:
 * the two social lists of this rail are keyed on opposite things.
 */
export type BlockEntry = components['schemas']['BlockEntry'];

/**
 * Exported so `friend-mutations.ts` invalidates the very key this hook reads. [FS-1] left this
 * as an explicit to-do on `useBlockUser` ("[FS-5] owns that screen and will add its own key
 * here rather than re-deciding the invalidation at its call site") — this is that key.
 */
export const BLOCKS_KEY = ['blocks'] as const;

/**
 * Everyone I have blocked.
 *
 * 🚨 SAME RULE AS `useFriendRequests`: ONLY CALL IT FROM A COMPONENT MOUNTED WHILE THE "ADD
 * FRIEND" TAB IS VISIBLE. The rail is on every authenticated page; an unconditional hook would
 * fire this GET on every screen of the app.
 */
export function useBlocks() {
  return useQuery({
    queryKey: BLOCKS_KEY,
    queryFn: () => apiFetch<BlocksResponse>('/blocks'),
    retry: retryServerErrorsOnly,
  });
}

/** `GET /blocks`. No refusal of its own beyond the shared ones. */
export function blocksErrorMessage(error: unknown) {
  return sharedApiErrorMessage(error) ?? 'Could not load your blocked players.';
}
