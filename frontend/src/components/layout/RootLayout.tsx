import { useEffect } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';

import { titleForPath } from '@/lib/page-title';

export function RootLayout() {
  const pathname = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  });

  // Un seul endroit pose le titre de l'onglet, pour TOUTE l'application — voir `titleForPath`
  // (WCAG 2.4.2, niveau A : les 13 routes rendaient auparavant le même « VS MODE »).
  useEffect(() => {
    if (!pathname) return;

    document.title = titleForPath(pathname);
  }, [pathname]);

  return (
    <div className="arena-background min-h-screen text-text-primary">
      <Outlet />
    </div>
  );
}
