import { useEffect } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

const connectRoutes = new Set(['/login', '/register']);

export function RootLayout() {
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  });

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
