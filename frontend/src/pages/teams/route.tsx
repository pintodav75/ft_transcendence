// Layout for the /teams section: owns the floating nav rails + footer chrome so
// the list (index.tsx) and single-team (team-detail.tsx) pages render inside the
// <Outlet /> without each repeating the shell.

import { Outlet } from '@tanstack/react-router';

import { LeftNav } from '@/components/layout/LeftNav';
import { RightNav } from '@/components/layout/RightNav';
import { SiteFooter } from '@/components/layout/SiteFooter';

export function TeamsLayout() {
  return (
    <>
      <LeftNav />
      <RightNav />
      <div className="relative z-10 h-screen overflow-y-auto pl-80 pr-28 py-4">
        <Outlet />
        <SiteFooter />
      </div>
    </>
  );
}

export default TeamsLayout;
