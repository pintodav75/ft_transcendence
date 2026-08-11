import { Outlet } from '@tanstack/react-router';

import { LeftRail } from '@/components/layout/LeftRail';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { RightRail } from '@/components/layout/RightRail';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { useRealtimeConnection } from '@/hooks/use-realtime-connection';

export function AuthenticatedLayout() {
  useRealtimeConnection();

  return (
    <div className="relative flex min-h-dvh gap-4 p-4">

      <a
        href="#main"
        className="absolute left-6 top-6 z-30 -translate-y-24 rounded-control border border-border-strong bg-surface-card-strong px-4 py-2 text-sm label-caps text-text-primary focus-ring focus-visible:outline-offset-2 focus:translate-y-0"
      >
        Skip to content
      </a>

      <LeftRail />

      <div className="flex min-h-[calc(100dvh-2rem)] min-w-0 flex-1 flex-col">
        <MobileHeader />

        <main id="main" tabIndex={-1} className="flex-1 focus-ring focus-visible:outline-offset-2">
          <Outlet />
        </main>
        <SiteFooter />
      </div>

      <RightRail />
    </div>
  );
}
