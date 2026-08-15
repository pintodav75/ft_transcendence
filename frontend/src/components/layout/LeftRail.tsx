// Left rail, full-height floating panel.

import { useRouterState } from '@tanstack/react-router';

import { AuthNav } from '@/components/layout/AuthNav';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { SiteLogo } from '@/components/layout/SiteLogo';
import { SearchBar } from '@/components/search/SearchBar';

export function LeftRail() {
  // Ce rail vit dans le layout `_authenticated` : il n'est PAS remonté quand on change de page,
  // seul le centre change.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    // Pas d'`aria-label` ici : l'`<aside>` est un landmark « complementary », le nommer «
    // Primary navigation » ferait annoncer « complémentaire, Primary navigation » puis, juste
    // après, une « navigation » anonyme.
    <aside className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-66 shrink-0 flex-col overflow-y-auto px-4 py-4.5 lg:flex">

      <SiteLogo className="mb-4 block text-center text-3xl" />

      <div className="mb-1.5">
        <SearchBar key={pathname} small />
      </div>

      <hr className="mx-0.5 my-3 border-border-subtle" />

      <PrimaryNav />

      {/* auth actions, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-3" />
    </aside>
  );
}
