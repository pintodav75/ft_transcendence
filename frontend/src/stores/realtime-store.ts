import { create } from 'zustand'

export type RealtimeConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'

type RealtimeStore = {
  connectionState: RealtimeConnectionState
  onlineFriendIds: string[]
  hasPresenceSnapshot: boolean
  setConnectionState: (connectionState: RealtimeConnectionState) => void
  replacePresence: (onlineFriendIds: string[]) => void
  setFriendPresence: (userId: string, online: boolean) => void
  resetSocialState: () => void
}

export const useRealtimeStore = create<RealtimeStore>((set) => ({
  connectionState: 'closed',
  onlineFriendIds: [],
  hasPresenceSnapshot: false,

  setConnectionState: (connectionState) =>
    set((state) => ({
      connectionState,
      // The ids may remain useful until the next snapshot, but their count is stale while the
      // transport is reconnecting and must not be presented as current information.
      hasPresenceSnapshot:
        connectionState === 'reconnecting' ? false : state.hasPresenceSnapshot,
    })),

  replacePresence: (onlineFriendIds) =>
    set({
      onlineFriendIds: [...new Set(onlineFriendIds)],
      hasPresenceSnapshot: true,
    }),

  setFriendPresence: (userId, online) =>
    set((state) => {
      const onlineFriendIds = new Set(state.onlineFriendIds)

      if (online) {
        onlineFriendIds.add(userId)
      } else {
        onlineFriendIds.delete(userId)
      }

      return { onlineFriendIds: [...onlineFriendIds] }
    }),

  resetSocialState: () =>
    set({
      connectionState: 'closed',
      onlineFriendIds: [],
      hasPresenceSnapshot: false,
    }),
}))
