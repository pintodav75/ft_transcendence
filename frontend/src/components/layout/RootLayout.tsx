import { useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

import { useAuthStore } from '@/stores/auth-store';

export function RootLayout() {
  const restoreSession = useAuthStore((state) => state.restoreSession);

  // The root layout stays mounted across routes, so restoring here covers
  // every entry point without repeating the request on each page.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <div className="arena-background min-h-screen text-text-primary">
      <Outlet />
      <TanStackRouterDevtools />
    </div>
  );
}
