// Les six (sept pour un admin) destinations de l'application, extraites du rail.
//
// 🚨 EXTRAIT PARCE QU'IL Y A DEUX CONSOMMATEURS, PAS UN : le rail de gauche (`LeftRail`, visible
// à partir de `lg`) et le tiroir du `MobileHeader` (sous `lg`). Le rail était `hidden lg:flex` et
// l'en-tête mobile n'ouvrait que le panneau social : sous 1024 px il n'existait donc AUCUNE
// navigation et AUCUN moyen de se déconnecter. Le sujet exige « a frontend that is clear,
// responsive, and accessible across all devices » — c'était un motif de rejet, pas une dette.
//
// 🔑 LES DEUX MONTAGES NE COEXISTENT JAMAIS DANS L'ARBRE D'ACCESSIBILITÉ : le rail est masqué par
// `display:none` sous `lg` (donc retiré de l'arbre, pas seulement de l'écran) et le tiroir n'est
// monté qu'à l'ouverture, à une largeur où le rail est justement masqué. Il ne peut donc pas y
// avoir deux landmarks « Primary navigation » annoncés en même temps.

import { Flag, Gamepad2, Gavel, History, House, Swords, User } from 'lucide-react';

import { MenuItem } from '@/components/ui/menu-item';
import { Pill } from '@/components/ui/pill';
import { useDisputeQueue, useIsAdmin } from '@/lib/admin-disputes';

export function PrimaryNav() {
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
   * ⚠️ C'est aussi ce qui rend le double consommateur gratuit : quand le tiroir mobile s'ouvre,
   * les deux montages partagent la même entrée de cache — aucune requête supplémentaire.
   */
  const isAdmin = useIsAdmin();
  const disputeQueue = useDisputeQueue(isAdmin);
  const openDisputes = disputeQueue.data?.disputes.length ?? 0;

  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-0.5">
      <MenuItem to="/home">
        <House aria-hidden="true" className="size-4" /> Home
      </MenuItem>
      <MenuItem to="/teams">
        <Flag aria-hidden="true" className="size-4" /> My teams
      </MenuItem>
      <MenuItem to="/solo">
        <User aria-hidden="true" className="size-4" /> Solo
      </MenuItem>
      <MenuItem to="/games">
        <Gamepad2 aria-hidden="true" className="size-4" /> Games
      </MenuItem>
      <MenuItem to="/matchmaking">
        <Swords aria-hidden="true" className="size-4" /> Matchmaking
      </MenuItem>
      <MenuItem to="/history">
        <History aria-hidden="true" className="size-4" /> History
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
          <Gavel aria-hidden="true" className="size-4" /> Arbitration
        </MenuItem>
      )}
    </nav>
  );
}
