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

/**
 * 🚨 A FIRST CONNECTION IS NOT AN OUTAGE. The friends list comes back from the same origin
 * in a few milliseconds while the WebSocket still has a handshake to finish, so keying the
 * fallback on `hasPresenceSnapshot` alone flashed "not available right now" on a perfectly
 * healthy page load, every single load.
 *
 * `open` counts as waiting too: the socket is up but `initial_presence` has not arrived yet
 * — the same in-flight moment, and it is also what a successful reconnection goes through.
 *
 * Lives here rather than in a slot: [FS-1]'s friends list and [FS-3]'s conversation header
 * answer the exact same question, and two copies of this rule would drift apart the day one
 * of them is fixed.
 */
export function presenceStatusOf(
  hasPresenceSnapshot: boolean,
  connectionState: RealtimeConnectionState,
): PresenceStatus {
  if (hasPresenceSnapshot) return 'ready';

  return connectionState === 'connecting' || connectionState === 'open'
    ? 'waiting'
    : 'unavailable';
}

/**
 * Presence of ONE person, for a screen that shows a single partner rather than two groups.
 *
 * ⚠️ Returns `unknown` as soon as the snapshot is stale: the ids the store still holds are
 * the ones from BEFORE the drop, and rendering "Offline" from them would state, in the app's
 * own voice, something the server never said.
 */
export function presenceOf(
  userId: string,
  onlineFriendIds: string[],
  status: PresenceStatus,
): Presence {
  if (status !== 'ready') return 'unknown';

  return onlineFriendIds.includes(userId) ? 'online' : 'offline';
}
