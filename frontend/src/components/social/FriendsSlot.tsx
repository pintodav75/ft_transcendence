import { useRealtimeStore } from '@/stores/realtime-store'

export function FriendsSlot() {
  const onlineCount = useRealtimeStore((state) => state.onlineFriendIds.length)
  const hasPresenceSnapshot = useRealtimeStore((state) => state.hasPresenceSnapshot)

  return (
    <div className="space-y-2 p-4">
      <p className="text-sm font-semibold text-text-primary">Friends</p>
      <p className="text-sm text-text-secondary">
        {hasPresenceSnapshot
          ? `${onlineCount} friend${onlineCount === 1 ? '' : 's'} online`
          : 'Presence is synchronizing…'}
      </p>
    </div>
  )
}
