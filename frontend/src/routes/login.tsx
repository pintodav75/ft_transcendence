import { createFileRoute, redirect } from '@tanstack/react-router';

import Login from '@/pages/login';
import { useAuthStore } from '@/stores/auth-store';

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const { ready, restoreSession } = useAuthStore.getState();

    if (!ready) {
      await restoreSession();
    }

    if (useAuthStore.getState().user) {
      throw redirect({ to: '/' });
    }
  },
  component: Login,
});
