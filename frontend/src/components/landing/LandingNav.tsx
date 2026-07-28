import { AuthNav } from '@/components/layout/AuthNav';
import { SiteLogo } from '@/components/layout/SiteLogo';

export function LandingNav() {
  return (
    // ⚠️ `<aside>` et NON `<nav>` : ce panneau CONTIENT une navigation (celle d'`AuthNav`,
    // nommée « Account »), il n'en est pas une. Tant qu'`AuthNav` n'avait pas son propre
    // landmark, le `<nav>` d'ici faisait l'affaire ; depuis qu'il en pose un, garder celui-ci
    // imbriquait une navigation dans une navigation sur la page d'entrée publique du projet.
    <aside className="panel @container hidden w-[30%] max-w-[300px] shrink-0 flex-col p-6 md:flex">
      <SiteLogo className="block text-center text-[length:23cqw]" />

      {/* language + auth, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-6" />
    </aside>
  );
}
