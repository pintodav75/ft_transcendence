import { Outlet } from '@tanstack/react-router';

import { LeftRail } from '@/components/layout/LeftRail';
import { RightRail } from '@/components/layout/RightRail';
import { SiteFooter } from '@/components/layout/SiteFooter';

export function AuthenticatedLayout() {
  return (
    <div className="relative flex min-h-dvh gap-4 p-4">
      {/* Le rail place une dizaine d'arrêts de tabulation (recherche + 6 items + compte)
          AVANT le contenu, sur toutes les pages authentifiées : sans ce lien, atteindre la
          page au clavier coûte autant de Tab à chaque navigation.
          ⚠️ Caché par TRANSLATION, surtout pas par `sr-only` + `focus:not-sr-only` : cette
          paire compile un `padding:0` de spécificité (0,2,0) qui bat les `px-4`/`py-2` en
          (0,1,0) ET les suit dans la feuille — le lien se rendait alors sans aucun padding,
          en 149 × 22 px, donc SOUS la cible de 24 px exigée par WCAG 2.5.8. La translation
          n'entre en conflit avec aucune autre utilitaire. */}
      <a
        href="#main"
        className="absolute left-6 top-6 z-30 -translate-y-24 rounded-control border border-border-strong bg-surface-card-strong px-4 py-2 text-sm label-caps text-text-primary focus-ring focus-visible:outline-offset-2 focus:translate-y-0"
      >
        Skip to content
      </a>

      <LeftRail />

      <div className="flex min-h-[calc(100dvh-2rem)] min-w-0 flex-1 flex-col">
        {/* `tabIndex={-1}` : sans lui, suivre `#main` déplace bien le point de départ de la
            tabulation dans Chrome mais pas le focus lui-même — un lecteur d'écran continue
            de lire le rail. */}
        <main id="main" tabIndex={-1} className="flex-1 focus-ring focus-visible:outline-offset-2">
          <Outlet />
        </main>
        <SiteFooter />
      </div>

      <RightRail />
    </div>
  );
}
