import { useEffect } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

import { useAuthStore } from '@/stores/auth-store';

const connectRoutes = new Set(['/login', '/register']);

export function RootLayout() {
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  });

  // The root layout stays mounted across routes, so restoring here covers
  // every entry point without repeating the request on each page.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!pathname) return;

    document.title = connectRoutes.has(pathname) ? 'VS MODE Connect' : 'VS MODE';
  }, [pathname]);

  return (
    <div className="arena-background min-h-screen text-text-primary">
      <Outlet />
      <TanStackRouterDevtools />
    </div>
  );
}
