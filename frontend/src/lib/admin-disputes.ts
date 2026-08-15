import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { disputeWindowMsLeft } from '@/lib/dispute-detail';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useAuthStore } from '@/stores/auth-store';

import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of the arbitration queue: GET /disputes, admin only.
 *
 * every reader must pass useIsAdmin() down to `enabled`. a non-admin firing this gets a 403,
 * and a red console line is a rejection motive. that's why the query and its guard live in the
 * same file.
 * one cache entry for two readers (the rail badge and /admin/disputes) so they can't disagree,
 * and an admin pays one request a minute instead of one per screen.
 * an admin is a normal player too — this is an extra tab, not a different app.
 */
type DisputeQueueResponse = paths['/disputes']['get']['responses'][200]['content']['application/json'];

/** One row of the queue: the dispute, its match context, its two camps. */
export type DisputeQueueEntry = DisputeQueueResponse['disputes'][number];
/** A camp of a queued dispute. */
export type DisputeQueueSide = DisputeQueueEntry['sides'][number];

/** Does this account arbitrate? */
export function useIsAdmin() {
  return useAuthStore((state) => state.user?.isAdmin === true);
}

export function disputeQueueKey() {
  return ['disputes', 'open'] as const;
}

/** Every dispute still waiting on an arbiter, OLDEST FIRST. */
export function useDisputeQueue(enabled: boolean) {
  return useQuery({
    queryKey: disputeQueueKey(),
    queryFn: () => apiFetch<DisputeQueueResponse>('/disputes'),
    enabled,
    staleTime: 60_000,
    // A 403 is a verdict, not a hiccup: retrying it three times only triples the red lines.
    retry: retryServerErrorsOnly,
  });
}

// ------------------------------------------------------------------ the clock

/** How long this file has been waiting on an arbiter. `null` when `createdAt` is unparsable. */
export function disputeAgeMs(entry: Pick<DisputeQueueEntry, 'createdAt'>, nowMs: number) {
  const opened = new Date(entry.createdAt).getTime();
  if (Number.isNaN(opened)) return null;

  return Math.max(0, nowMs - opened);
}

/**
 * Milliseconds left before the job cancels this file — negative once the window is past, `null`
 * on an unparsable instant.
 */
export function disputeQueueMsLeft(entry: Pick<DisputeQueueEntry, 'createdAt'>, nowMs: number) {
  return disputeWindowMsLeft(entry.createdAt, nowMs);
}
