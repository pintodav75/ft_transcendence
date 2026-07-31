import { useEffect } from 'react'

import { realtimeClient } from '@/lib/realtime-client'
import { useAuthStore } from '@/stores/auth-store'

export function useRealtimeConnection() {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const accessToken = useAuthStore((state) => state.accessToken)

  useEffect(() => {
    if (!userId || !accessToken) {
      realtimeClient.disconnect()
      return
    }

    realtimeClient.connect(userId, accessToken)
  }, [accessToken, userId])
}
