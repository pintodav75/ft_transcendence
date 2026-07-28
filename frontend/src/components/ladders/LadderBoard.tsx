import { LadderRow, LadderRowHeader } from '@/components/ladders/LadderRow';
import { isTeamCompetitor } from '@/lib/ladders';

import type { RankingEntry } from '@/lib/ladders';

type LadderBoardProps = {
  /** Already sorted by the backend (Elo descending) — never re-sorted here. */
  entries: RankingEntry[];
  /** Team whose row is highlighted instead of linked, when the board is shown on its page. */
  selfTeamId?: string;
  selfNote?: string;
};

/**
 * The bordered standings box: header row + one row per competitor. Shared by the five-row
 * excerpt of a team page and the full board of a ladder page — the second reader is what
 * pulled it out of `LadderExcerpt`, box and list semantics included, so neither screen
 * copies the other's classes.
 *
 * `<ol>` because the order IS the information (rank), and `role="list"` explicitly because
 * Safari drops list semantics from a styled list.
 *
 * ⚠️ NI pagination NI conteneur défilant — décision produit de David, 28/07, prise avec la
 * mesure sous les yeux : à 200 compétiteurs la page fait 11 431 px (16 écrans) pour 2941
 * nœuds DOM et 1278 ms de rendu. Le coût DOM n'est donc pas le sujet ; ce qu'on accepte,
 * c'est que l'utilisateur descende la page, et que les règles et le pool de maps se
 * retrouvent au-dessus d'un long classement. Contrepartie assumée : le Ctrl+F du navigateur
 * porte sur TOUT le classement, et arriver depuis sa page équipe ne fait perdre personne
 * dans une page 1 qui ne le contient pas. À rouvrir si un ladder dépasse la centaine.
 */
export function LadderBoard({ entries, selfTeamId, selfNote }: LadderBoardProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border-subtle">
      <LadderRowHeader />
      <ol role="list">
        {entries.map((entry) => (
          // `competitor.id` is a uuid and unique within one ladder: stable across refetches,
          // unlike the array index or the rank.
          <li key={entry.competitor.id}>
            <LadderRow
              entry={entry}
              isSelf={
                selfTeamId !== undefined &&
                isTeamCompetitor(entry.competitor) &&
                entry.competitor.id === selfTeamId
              }
              selfNote={selfNote}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
