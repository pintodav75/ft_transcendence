// Left rail, full-height floating panel.
//
// Dimensions come straight from the /home mockup (`vsmode-home-demo.html`, `.left`):
// 264 px wide, 18 px vertical / 16 px horizontal padding, a 30 px wordmark, 16 px icons
// and 2 px between items. Colours, radii and shadows come from the design system
// (`index.css`), never from the mockup's own values.

import { useRouterState } from '@tanstack/react-router';

import { AuthNav } from '@/components/layout/AuthNav';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { SiteLogo } from '@/components/layout/SiteLogo';
import { SearchBar } from '@/components/search/SearchBar';

export function LeftRail() {
  // Ce rail vit dans le layout `_authenticated` : il n'est PAS remonté quand on change de
  // page, seul le centre change. La recherche gardait donc son texte et son panneau ouvert
  // d'une page à l'autre, posés sur la nav de la page suivante. Servir le pathname en `key`
  // remonte la barre à chaque route, ce qui vide son état — l'idiome React pour réinitialiser
  // un enfant sans aller tripoter son état interne. La query `['ladders']` est en cache au
  // niveau du QueryClient (staleTime 1 h), pas du composant : le remontage ne relance donc
  // aucune requête.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    // Pas d'`aria-label` ici : l'`<aside>` est un landmark « complementary », le nommer
    // « Primary navigation » ferait annoncer « complémentaire, Primary navigation » puis,
    // juste après, une « navigation » anonyme. C'est le <nav> plus bas qui porte le nom.
    // `overflow-y-auto` : le rail est en hauteur de fenêtre fixe et `sticky`. Sans lui, sur une
    // fenêtre courte (< ~536 px, ce qu'on atteint dès qu'on ancre DevTools en bas), `mt-auto`
    // poussait Profile/Logout HORS du panneau et hors de l'écran — et `sticky` interdisait de
    // défiler pour les rattraper : plus aucun moyen de se déconnecter.
    <aside className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-66 shrink-0 flex-col overflow-y-auto px-4 py-4.5 lg:flex">
      {/* `block` : <SiteLogo> rend un <a>, donc inline — sans ça `text-center` n'a aucune
          boîte à centrer. */}
      <SiteLogo className="mb-4 block text-center text-3xl" />

      {/* HORS du <nav> : c'est un champ de recherche, pas un lien de navigation — le mettre
          dedans le fait compter comme une entrée de la nav par un lecteur d'écran. */}
      <div className="mb-1.5">
        <SearchBar key={pathname} small />
      </div>

      <hr className="mx-0.5 my-3 border-border-subtle" />

      {/* Les items eux-mêmes vivent dans `PrimaryNav` : le tiroir mobile sert exactement la même
          liste, admin compris (voir l'en-tête de ce fichier-là). */}
      <PrimaryNav />

      {/* auth actions, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-3" />
    </aside>
  );
}
