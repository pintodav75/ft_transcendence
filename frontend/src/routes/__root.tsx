// this is a frame that gets added to every route

import { useEffect } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useAuthStore } from '@/stores/auth-store';

function RootLayout() {
  const restoreSession = useAuthStore((state) => state.restoreSession);

  // Runs once for the whole app: the root layout stays mounted across every
  // route, so the session is restored no matter which route you land on.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
