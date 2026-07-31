// Left rail, full-height floating panel.
//
// Dimensions come straight from the /home mockup (`vsmode-home-demo.html`, `.left`):
// 264 px wide, 18 px vertical / 16 px horizontal padding, a 30 px wordmark, 16 px icons
// and 2 px between items. Colours, radii and shadows come from the design system
// (`index.css`), never from the mockup's own values.

import { Flag, Gamepad2, Gavel, History, House, Swords, User } from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';

import { MenuItem } from '@/components/ui/menu-item';
import { AuthNav } from '@/components/layout/AuthNav';
import { Pill } from '@/components/ui/pill';
import { SiteLogo } from '@/components/layout/SiteLogo';
import { SearchBar } from '@/components/search/SearchBar';
import { useDisputeQueue, useIsAdmin } from '@/lib/admin-disputes';

export function LeftRail() {
  // Ce rail vit dans le layout `_authenticated` : il n'est PAS remonté quand on change de
  // page, seul le centre change. La recherche gardait donc son texte et son panneau ouvert
  // d'une page à l'autre, posés sur la nav de la page suivante. Servir le pathname en `key`
  // remonte la barre à chaque route, ce qui vide son état — l'idiome React pour réinitialiser
  // un enfant sans aller tripoter son état interne. La query `['ladders']` est en cache au
  // niveau du QueryClient (staleTime 1 h), pas du composant : le remontage ne relance donc
  // aucune requête.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  /**
   * L'onglet d'arbitrage — [F-ADMIN].
   *
   * 🚨 UN NON-ADMIN NE DÉCLENCHE JAMAIS `GET /disputes`. `enabled: isAdmin` n'est pas une
   * optimisation : la route rend **403** à tout le monde d'autre, et un 403 écrit une ligne rouge
   * dans la console Chrome — motif de rejet du PROJET (invariant #10). Le rail étant monté sur
   * toutes les pages authentifiées, l'oubli coûterait une ligne rouge par page.
   *
   * 🔑 UN ADMIN RESTE UN JOUEUR ORDINAIRE (décision produit, David) : ceci AJOUTE un onglet, ça ne
   * transforme rien. Sa file de travail vit sur son propre écran, jamais mélangée à `/home`.
   *
   * ♻️ Même clé de cache que `/admin/disputes` (`staleTime` 60 s) : une seule requête réseau pour
   * le badge ET la page, et un badge qui ne peut pas contredire la liste vers laquelle il pointe.
   */
  const isAdmin = useIsAdmin();
  const disputeQueue = useDisputeQueue(isAdmin);
  const openDisputes = disputeQueue.data?.disputes.length ?? 0;

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

      <nav aria-label="Primary navigation" className="flex flex-col gap-0.5">
        <MenuItem to="/home">
          <House className="size-4" /> Home
        </MenuItem>
        <MenuItem to="/teams">
          <Flag className="size-4" /> My teams
        </MenuItem>
        <MenuItem to="/solo">
          <User className="size-4" /> Solo
        </MenuItem>
        <MenuItem to="/games">
          <Gamepad2 className="size-4" /> Games
        </MenuItem>
        <MenuItem to="/matchmaking">
          <Swords className="size-4" /> Matchmaking
        </MenuItem>
        <MenuItem to="/history">
          <History className="size-4" /> History
        </MenuItem>

        {/* 🔑 « Arbitration », délibérément PAS « Disputes » : un joueur a des litiges lui aussi
            (il les lit depuis /history), donc « Disputes » désignerait deux choses différentes
            selon qui regarde. « Arbitration » nomme le MÉTIER d'admin — sans ambiguïté pour un
            coéquipier comme pour le jury de soutenance.

            Le `Gavel` est celui du dossier de litige (`pages/disputes/dispute-detail.tsx`) : le
            lien entre les deux écrans se voit, il n'est pas seulement écrit.

            ⚠️ En DERNIÈRE position, sous History, et conditionnel : l'ordre des six items de tout
            le monde ne bouge pas d'un cran selon le compte connecté. */}
        {isAdmin && (
          <MenuItem
            to="/admin/disputes"
            tone="accent"
            trailing={
              // Pas de badge à 0 (rien à arbitrer n'est pas une alerte), ni tant que la requête
              // n'a pas répondu — sinon la ligne saute de largeur une fois la réponse arrivée.
              // C'est ce compte qui rend le rouge INFORMATIF plutôt que décoratif : un litige
              // s'aperçoit sans cliquer.
              openDisputes > 0 ? (
                <Pill tone="dispute">
                  {openDisputes}
                  {/* Le badge fait partie du NOM ACCESSIBLE du lien : sans ce mot, un lecteur
                      d'écran annonce « Arbitration 3 » et le 3 ne veut rien dire.
                      ⚠️ L'ESPACE INITIAL EST VOLONTAIRE et il est dans la chaîne, pas entre les
                      balises (JSX le mangerait) : deux nœuds de texte adjacents se concatènent
                      SANS séparateur, on lisait « 3open disputes ». L'insertion d'une espace au
                      calcul du nom accessible est laissée à l'implémentation par la spec — on ne
                      la suppose donc pas, on l'écrit. `sr-only` est `position:absolute`, donc
                      cette espace ne coûte aucune largeur à l'écran. */}
                  <span className="sr-only">
                    {openDisputes === 1 ? ' open dispute' : ' open disputes'}
                  </span>
                </Pill>
              ) : null
            }
          >
            <Gavel className="size-4" /> Arbitration
          </MenuItem>
        )}
      </nav>

      {/* auth actions, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-3" />
    </aside>
  );
}
