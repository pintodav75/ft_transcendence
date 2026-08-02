import { SiteFooter } from '@/components/layout/SiteFooter';
import { HeroBanner } from '@/components/landing/HeroBanner';
import { GamesCards } from '@/components/games/GamesCards';
import { SiteLogo } from '@/components/layout/SiteLogo';

export function Index() {
  return (
    <div className="flex min-h-dvh flex-col gap-6 p-4">
      {/* 🚨 LE WORDMARK EST OBLIGATOIRE ICI : c'est la page d'entrée du projet, et depuis le
          retrait du rail latéral rien n'y NOMMAIT plus le site — un correcteur arrivait sur une
          page qui ne dit pas comment elle s'appelle. Même dosage que les pages légales : un
          `<header>` sobre, le wordmark seul.

          🔑 `SiteLogo` et pas un titre écrit à la main : il n'est délibérément PAS un `<h1>`
          (voir son commentaire), donc il ne vient pas se placer avant le vrai titre de la page
          dans la liste des titres d'un lecteur d'écran. Il pointe déjà vers le bon accueil. */}
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
