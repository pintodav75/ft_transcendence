import { createFileRoute, redirect } from '@tanstack/react-router'

import { Dashboard } from '@/pages/dashboard'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const { ready, restoreSession } = useAuthStore.getState()

    // On a hard reload the session isn't resolved yet; wait for the refresh
    // attempt before deciding (deduped in the store, so this is cheap).
    if (!ready) {
      await restoreSession()
    }

    // Re-read after awaiting — restoreSession may have populated the user.
    if (!useAuthStore.getState().user) {
      throw redirect({ to: '/login' })
    }
  },
  component: Dashboard,
})
