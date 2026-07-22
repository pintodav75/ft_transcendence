import { Outlet } from '@tanstack/react-router';

import { LeftRail } from '@/components/layout/LeftRail';
import { RightRail } from '@/components/layout/RightRail';
import { SiteFooter } from '@/components/layout/SiteFooter';

export function AuthenticatedLayout() {
  return (
    <div className="flex min-h-dvh gap-4 p-4">
      <LeftRail />

      <div className="flex min-h-[calc(100dvh-2rem)] min-w-0 flex-1 flex-col">
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>

      <RightRail />
    </div>
  );
}
