import { AuthNav } from '@/components/layout/AuthNav';
import { SiteLogo } from '@/components/layout/SiteLogo';

export function LandingNav() {
  return (
    <nav
      aria-label="Main"
      className="panel @container hidden w-[30%] max-w-[300px] shrink-0 flex-col p-6 md:flex"
    >
      <SiteLogo className="block text-center text-[length:23cqw]" />

      {/* language + auth, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-6" />
    </nav>
  );
}
