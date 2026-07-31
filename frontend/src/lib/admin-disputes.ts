import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api';
import { disputeWindowMsLeft } from '@/lib/dispute-detail';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { useAuthStore } from '@/stores/auth-store';

import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of the ARBITRATION QUEUE — `GET /disputes`, admin only.
 *
 * 🚨 THE WHOLE MODULE IS GATED ON `isAdmin`, AND THAT IS ITS REASON TO EXIST. Every reader here
 * must pass `useIsAdmin()` down to `enabled`, because a non-admin who fires this request gets a
 * **403** — and a 403 writes a red line in the Chrome console, which is a project-rejection
 * criterion for the whole subject, not a rough edge. Keeping the query in one module with the
 * guard stated next to it is what stops a future caller from re-deriving that rule wrongly.
 *
 * 🔑 ONE CACHE ENTRY FOR TWO READERS. The count badge of the left rail and the `/admin/disputes`
 * page read the SAME key with the same `staleTime`, so an admin walking through the app pays one
 * request per minute, not one per screen. Splitting them would double the traffic AND let the
 * badge disagree with the list it links to.
 *
 * ⚠️ AN ADMIN IS AN ORDINARY PLAYER TOO (product decision, David): this is an extra tab on his
 * rail, never a different app. Nothing here changes what a player sees — the queue is additive.
 */
type DisputeQueueResponse = paths['/disputes']['get']['responses'][200]['content']['application/json'];

/** One row of the queue: the dispute, its match context, its two camps. */
export type DisputeQueueEntry = DisputeQueueResponse['disputes'][number];
/**
 * A camp of a queued dispute.
 *
 * 🔑 A STRICT SUBSET of `GET /disputes/{id}`'s and `GET /matches/{id}`'s own `sides` (no score,
 * no submission, no Elo), so `sideName` / `sideAvatarUrl` / `sideInitials` consume it AS IS —
 * they are structural. No variant is written for this screen.
 */
export type DisputeQueueSide = DisputeQueueEntry['sides'][number];

/**
 * Does this account arbitrate?
 *
 * ⚠️ `=== true`, not a bare truthiness test: `user` is `null` while the session boots, and an
 * `undefined` that reads as "not yet known" must behave like "not an admin" — the safe direction
 * is the one that spends NO request.
 *
 * ⚠️ `AuthUser` is hand-written (`types/auth.ts`) rather than derived from the codegen. That is a
 * known debt of the repo, deliberately NOT refactored by this ticket; the field is served by
 * `/auth/register`, `/auth/login` and `GET /users/me` all the same.
 */
export function useIsAdmin() {
  return useAuthStore((state) => state.user?.isAdmin === true);
}

export function disputeQueueKey() {
  return ['disputes', 'open'] as const;
}

/**
 * Every dispute still waiting on an arbiter, OLDEST FIRST.
 *
 * 🚨 THE ORDER COMES FROM THE SERVER AND IS NEVER RE-SORTED HERE. `GET /disputes` orders by
 * `createdAt` ascending — i.e. by how close each file is to being cancelled by the 24 h job — and
 * that IS the processing order an arbiter needs. Re-sorting on the client would silently disagree
 * with the contract the day the backend refines it.
 *
 * 🔑 `staleTime` OF ONE MINUTE, deliberately between the two extremes the repo already uses.
 * Reference data caches for an hour (it does not move); the dispute file caches for zero (its
 * urls expire). This is a WORK QUEUE: a minute old is fine to look at, and it is what keeps the
 * badge from re-requesting on every navigation of the persistent rail.
 *
 * @param enabled `useIsAdmin()`. **Never `true` unconditionally** — see the module docblock.
 */
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

/**
 * How long this file has been waiting on an arbiter. `null` when `createdAt` is unparsable.
 *
 * 🔑 THE AGE IS THE POINT OF THE QUEUE, and it is not cosmetic: a dispute nobody settles is
 * CANCELLED after `DISPUTE_WINDOW_HOURS` hours by job C — the match then counts for nothing and
 * no Elo moves for anyone. An arbiter who cannot see which file is about to expire has no way to
 * choose which one to open first.
 */
export function disputeAgeMs(entry: Pick<DisputeQueueEntry, 'createdAt'>, nowMs: number) {
  const opened = new Date(entry.createdAt).getTime();
  if (Number.isNaN(opened)) return null;

  return Math.max(0, nowMs - opened);
}

/**
 * Milliseconds left before the job cancels this file — negative once the window is past, `null`
 * on an unparsable instant.
 *
 * ⚠️ NOT A SECOND IMPLEMENTATION OF THE 24 h RULE. It delegates to `disputeWindowMsLeft`, the
 * same function the dispute file itself runs on; a queue that counted down differently from the
 * screen it links to would be worse than no countdown at all.
 *
 * ⚠️ NO `status` GUARD, unlike `disputeMsLeft`: `GET /disputes` only ever lists `open` files, so
 * there is nothing to branch on here.
 */
export function disputeQueueMsLeft(entry: Pick<DisputeQueueEntry, 'createdAt'>, nowMs: number) {
  return disputeWindowMsLeft(entry.createdAt, nowMs);
}
