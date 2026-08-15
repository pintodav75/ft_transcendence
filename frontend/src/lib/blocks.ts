import { useQuery } from '@tanstack/react-query';

import { apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { components, paths } from '@/lib/api-types.gen';

type BlocksResponse = paths['/blocks']['get']['responses'][200]['content']['application/json'];

/** One account I have blocked. */
export type BlockEntry = components['schemas']['BlockEntry'];

/** Exported so `friend-mutations.ts` invalidates the very key this hook reads. */
export const BLOCKS_KEY = ['blocks'] as const;

/** Everyone I have blocked. */
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
