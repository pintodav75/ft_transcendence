import { createFileRoute, redirect } from '@tanstack/react-router';
import { TeamsLayout } from '@/pages/teams/route';
import { useAuthStore } from '@/stores/auth-store';

export const Route = createFileRoute('/teams')({
  // Guard the whole /teams section (list + $teamId detail) in one place.
  beforeLoad: async () => {
    const { ready, restoreSession } = useAuthStore.getState();

    // On a hard reload the session isn't resolved yet; wait for the refresh
    // attempt before deciding (deduped in the store, so this is cheap).
    if (!ready) {
      await restoreSession();
    }

    // Re-read after awaiting — restoreSession may have populated the user.
    if (!useAuthStore.getState().user) {
      throw redirect({ to: '/' });
    }
  },
  component: TeamsLayout,
});
