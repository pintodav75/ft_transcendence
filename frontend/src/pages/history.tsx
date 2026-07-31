import { History as HistoryIcon } from 'lucide-react';
import { useState } from 'react';

import { ActionRequired } from '@/components/matches/ActionRequired';
import { Callout } from '@/components/ui/callout';
import { HistoryFilters } from '@/components/history/HistoryFilters';
import { HistoryMatches } from '@/components/history/HistoryMatches';
import { SectionTitle } from '@/components/ui/section-title';
import { useAnnouncement } from '@/lib/use-announcement';
import {
  EMPTY_HISTORY_FILTERS,
  applyHistoryFilters,
  hasActiveHistoryFilters,
  historyFormatOptions,
  historyGameOptions,
  historyResultOptions,
  historySummary,
  needsMyAttention,
  useMatchLabeller,
  useMyMatchHistory,
} from '@/lib/history';

import type { HistoryFilterState } from '@/lib/history';

/**
 * `/history` — every match of mine, all games and all ladders at once.
 *
 * 🔑 THE ONLY CROSS-CUTTING VIEW IN THE APP. Until now, finding out what you had played meant
 * visiting one page per team AND one `/solo/$ladderId` per ladder and stitching the pieces
 * together. `GET /matches/me` with no parameter already unions the two sources (matches I was
 * fielded in, and matches of my teams where I sat on the bench), so this page is one request.
 *
 * 🚨 ITS REAL VALUE IS THE FIRST SECTION, not the table. `awaiting_confirmation` and
 * `disputed` are on a 24 h clock and nothing else in the app groups them — see
 * `ActionRequired`.
 *
 * 🚨 NO GLOBAL WIN–LOSS RECORD. A cross-ladder record means nothing (ten wins at chess and
 * ten losses on cs2 are not "50 %"), and the payload does not even say whether I was fielded
 * or on the bench. The record already exists per ladder, where it has a meaning.
 *
 * ⚠️ EXACTLY ONE LIVE REGION (invariant #11), and it is the filters that need it. Changing a
 * `<select>` announces the option that was picked and NOTHING about its effect — yet on this
 * screen the four controls have no other effect than re-filling the table (WCAG 4.1.3). It is
 * mounted permanently and empty: a region inserted at the same time as its text is not
 * reliably announced, the screen reader has to be watching it already.
 *
 * ⚠️ `/matchmaking` has the same gap and stays silent for now — its summary is a plain
 * paragraph. Aligning it is its own change, not something to smuggle in here.
 *
 * ⚠️ NO PAGINATION AND NO SCROLLING BOX — same arbitration as `LadderBoard` (FT-3): we keep
 * Ctrl+F over the whole history. The table keeps its own internal `overflow-x-auto`, which is
 * a different thing and does not move.
 */
export function History() {
  const [filters, setFilters] = useState<HistoryFilterState>(EMPTY_HISTORY_FILTERS);

  const announcement = useAnnouncement();
  const historyQuery = useMyMatchHistory();
  // Both come from the reference caches (`GET /games`, `GET /ladders`, one hour of freshness)
  // that every other screen already fills — no request per row, ever.
  const labels = useMatchLabeller();

  const matches = historyQuery.data?.matches ?? [];

  // 🚨 Read from the FULL history, never from the filtered list: a match waiting on me must
  // not be hideable behind a filter — that is the whole point of the section.
  const waitingOnMe = matches.filter(needsMyAttention);

  const visible = applyHistoryFilters(matches, filters);
  const filtersActive = hasActiveHistoryFilters(filters);

  // Derived at render, not stored in state: they are a pure function of the data and of the
  // selected game, and an effect syncing them would render one frame of the wrong menu.
  const gameOptions = historyGameOptions(matches, labels.gameName);
  const formatOptions = historyFormatOptions(matches, filters.gameId);
  const resultOptions = historyResultOptions(matches);

  // `null` en erreur, ET PAS une phrase de plus : le `Callout` juste au-dessus dit déjà tout,
  // et le répéter en petit gris sous les filtres faisait dire deux fois la même chose à
  // l'écran — sans rien ajouter, puisque le Callout porte aussi le remède.
  const summary = historyQuery.isPending
    ? 'Loading your matches…'
    : historyQuery.isError
      ? null
      : historySummary(visible.length, matches.length, filtersActive);

  /**
   * 🔑 CHANGER UN FILTRE N'A AUCUN AUTRE EFFET QUE DE CHANGER LA TABLE, et c'est ce qui rend
   * l'annonce nécessaire : un lecteur d'écran entend l'option qu'il vient de choisir, puis
   * plus rien — la liste sous ses doigts est devenue autre chose en silence (WCAG 4.1.3). Le
   * texte annoncé est celui de `historySummary`, le MÊME que la ligne visible : deux
   * formulations tenues à la main finiraient par diverger.
   */
  const applyFilters = (next: HistoryFilterState) => {
    setFilters(next);
    announcement.announce(
      historySummary(
        applyHistoryFilters(matches, next).length,
        matches.length,
        hasActiveHistoryFilters(next),
      ),
    );
  };

  return (
    <div className="panel flex min-w-0 flex-col gap-6 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <HistoryIcon aria-hidden="true" className="size-4" /> History
        </p>
        <h1 className="text-3xl label-caps-black">My matches</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Everything you have played, solo and with your teams, across every game and every
          ladder — most recent first. Each row opens its match sheet.
        </p>
      </header>

      {historyQuery.isError && (
        <Callout tone="danger">
          Your match history could not be loaded. Check your connection and reload the page.
        </Callout>
      )}

      <ActionRequired matches={waitingOnMe} ladderOf={labels.forMatch} />

      <SectionTitle>All matches</SectionTitle>

      {/* The filters are hidden while the history is empty or unavailable: four selects with
          one option each say nothing, and they would be the loudest thing on an empty page. */}
      {matches.length > 0 && (
        <HistoryFilters
          filters={filters}
          games={gameOptions}
          formats={formatOptions}
          results={resultOptions}
          onChange={applyFilters}
        />
      )}

      {/* La ligne VISIBLE. Elle n'est pas la région live : celle-ci est montée en permanence
          plus bas, vide, et ne parle qu'au changement d'un filtre. Rendre la ligne visible
          `role="status"` la ferait relire à chaque refetch, y compris quand rien n'a bougé. */}
      {/* ⚠️ `text-text-secondary` (7,81:1) et NON `text-text-muted` (4,23:1, sous AA) : c'est
          l'idiome du repo pour ce genre de ligne, mais il porte une dette de contraste connue,
          et cette ligne-ci est la seule qui dise combien de matchs sont affichés. `MatchRow`
          fait déjà ce même écart, pour la même raison. */}
      {summary && <p className="text-xs text-text-secondary">{summary}</p>}

      {/* L'UNIQUE région live de l'écran (invariant #11). `sr-only` : ce qu'elle dit est déjà
          écrit juste au-dessus pour qui le voit. */}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {/* Nothing here while loading or on error: the summary line right above already says
          both, and printing a second sentence made the screen repeat itself. */}
      {historyQuery.isPending || historyQuery.isError ? null : (
        <HistoryMatches
          matches={visible}
          totalCount={matches.length}
          ladderOf={labels.forMatch}
          filtersActive={filtersActive}
          onClearFilters={() => applyFilters(EMPTY_HISTORY_FILTERS)}
        />
      )}
    </div>
  );
}
