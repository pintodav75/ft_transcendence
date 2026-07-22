import { createFileRoute, redirect } from '@tanstack/react-router';

import { Register } from '@/pages/register';
import { useAuthStore } from '@/stores/auth-store';

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    const { ready, restoreSession } = useAuthStore.getState();

    if (!ready) {
      await restoreSession();
    }

    if (useAuthStore.getState().user) {
      throw redirect({ to: '/home' });
    }
  },
  component: Register,
});
