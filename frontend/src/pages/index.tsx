import { SiteFooter } from '@/components/layout/SiteFooter';
import { HeroBanner } from '@/components/landing/HeroBanner';
import { GamesCards } from '@/components/games/GamesCards';
import { SiteLogo } from '@/components/layout/SiteLogo';

export function Index() {
  return (
    <div className="flex min-h-dvh flex-col gap-6 p-4">

      <header>
        <SiteLogo className="text-2xl" />
      </header>

      <main className="flex-1 space-y-6">
        <HeroBanner />
        <GamesCards />
      </main>
      <SiteFooter />
    </div>
  );
}

export default Index;
