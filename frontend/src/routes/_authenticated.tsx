import { createFileRoute, redirect } from '@tanstack/react-router';

import { AuthenticatedLayout } from '@/components/layout/AuthenticatedLayout';
import { useAuthStore } from '@/stores/auth-store';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const { ready, restoreSession } = useAuthStore.getState();

    if (!ready) {
      await restoreSession();
    }

    if (!useAuthStore.getState().user) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthenticatedLayout,
});
