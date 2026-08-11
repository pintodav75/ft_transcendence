import type { RealtimeConnectionState } from '@/stores/realtime-store';

/** What a screen is allowed to SAY about somebody's presence — `unknown` is a state, not a default. */
export type Presence = 'online' | 'offline' | 'unknown';

/**
 * What the client knows about presence RIGHT NOW, which is not the same question as "is the
 * socket up".
 *
 * - `ready` — a snapshot has landed, "online" and "offline" mean something.
 * - `waiting` — the transport is still opening its FIRST connection (or has just reopened
 *   and the snapshot is in flight). Nothing is wrong; the answer is simply not in yet.
 * - `unavailable` — the connection dropped or was refused. That one IS worth saying.
 */
export type PresenceStatus = 'ready' | 'waiting' | 'unavailable';

/** A FIRST CONNECTION IS NOT AN OUTAGE. */
export function presenceStatusOf(
  hasPresenceSnapshot: boolean,
  connectionState: RealtimeConnectionState,
): PresenceStatus {
  if (hasPresenceSnapshot) return 'ready';

  return connectionState === 'connecting' || connectionState === 'open'
    ? 'waiting'
    : 'unavailable';
}

/** Presence of ONE person, for a screen that shows a single partner rather than two groups. */
export function presenceOf(
  userId: string,
  onlineFriendIds: string[],
  status: PresenceStatus,
): Presence {
  if (status !== 'ready') return 'unknown';

  return onlineFriendIds.includes(userId) ? 'online' : 'offline';
}
