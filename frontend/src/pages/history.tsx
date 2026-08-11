// `/history` — every match of mine, all games and all ladders at once (those where you were benched also, with no distinction).
import { History as HistoryIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ActionRequired } from '@/components/matches/ActionRequired';
import { Callout } from '@/components/ui/callout';
import { HistoryFilters } from '@/components/history/HistoryFilters';
import { HistoryMatches } from '@/components/history/HistoryMatches';
import { Pagination } from '@/components/ui/pagination';
import { SectionTitle } from '@/components/ui/section-title';
import { useAnnouncement } from '@/lib/use-announcement';
import {
  DEFAULT_HISTORY_PAGE_SIZE,
  EMPTY_HISTORY_FILTERS,
  HISTORY_PAGE_SIZES,
  applyHistoryFilters,
  applyHistoryOrder,
  hasActiveHistoryFilters,
  historyFormatOptions,
  historyGameOptions,
  historyPage,
  historyPageForSize,
  historyResultOptions,
  historySummary,
  needsMyAttention,
  useMatchLabeller,
  useMyMatchHistory,
} from '@/lib/history';

import type { HistoryFilterState, HistoryPageSize } from '@/lib/history';

export function History() {
  const [filters, setFilters] = useState<HistoryFilterState>(EMPTY_HISTORY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<HistoryPageSize>(DEFAULT_HISTORY_PAGE_SIZE);

  const announcement = useAnnouncement();
  const historyQuery = useMyMatchHistory();
  // Both come from the reference caches (`GET /games`, `GET /ladders`, one hour of freshness)
  // that every other screen already fills — no request per row, ever.
  const labels = useMatchLabeller();

  const matches = historyQuery.data?.matches ?? [];

  // games waiting an action from me
  const waitingOnMe = matches.filter(needsMyAttention);

  // Filter, then order, then cut a page out of the result in that order
  const matched = applyHistoryFilters(matches, filters);
  const ordered = applyHistoryOrder(matched, filters.oldestFirst);
  const current = historyPage(ordered, page, pageSize);
  const filtersActive = hasActiveHistoryFilters(filters);

  // Derived at render, not stored in state: they are a pure function of the data and of the
  // selected game, and an effect syncing them would render one frame of the wrong menu.
  const gameOptions = historyGameOptions(matches, labels.gameName);
  const formatOptions = historyFormatOptions(matches, filters.gameId);
  const resultOptions = historyResultOptions(matches);

  /**
   * The one sentence both readers get, for any state of the controls — computed for a candidate
   * state so the announcement can describe the table the user is ABOUT to get.
   */
  const summaryOf = (state: HistoryFilterState, targetPage: number, size: number) => {
    const rows = applyHistoryFilters(matches, state);
    const { from, to } = historyPage(rows, targetPage, size);

    return historySummary({
      matched: rows.length,
      total: matches.length,
      filtersActive: hasActiveHistoryFilters(state),
      oldestFirst: state.oldestFirst,
      from,
      to,
    });
  };

  // `null` en erreur
  const summary = historyQuery.isPending
    ? 'Loading your matches…'
    : historyQuery.isError
      ? null
      : summaryOf(filters, page, pageSize);

  const announceTimer = useRef<number | undefined>(undefined);

  const announceSummary = (text: string, afterTyping: boolean) => {
    window.clearTimeout(announceTimer.current);
    if (!afterTyping) {
      announcement.announce(text);
      return;
    }
    announceTimer.current = window.setTimeout(() => announcement.announce(text), 700);
  };

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  const applyFilters = (next: HistoryFilterState, typed = false) => {
    setFilters(next);
    // BACK TO PAGE 1 ON EVERY CHANGE.
    setPage(1);
    announceSummary(summaryOf(next, 1, pageSize), typed);
  };

  const goToPage = (next: number) => {
    setPage(next);
    announceSummary(summaryOf(filters, next, pageSize), false);
  };

  // CHANGING THE PAGE SIZE KEEPS YOUR PLACE,
  const changePageSize = (next: HistoryPageSize) => {
    const nextPage = historyPageForSize(current.from, next);
    setPageSize(next);
    setPage(nextPage);
    announceSummary(summaryOf(filters, nextPage, next), false);
  };

  return (
    <div className="panel flex min-w-0 flex-col gap-6 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <HistoryIcon aria-hidden="true" className="size-4" /> History
        </p>
        <h1 className="text-3xl label-caps-black">My matches</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Everything you have played. Each row opens its match sheet.
        </p>
      </header>

      {historyQuery.isError && (
        <Callout tone="danger">
          Your match history could not be loaded. Check your connection and reload the page.
        </Callout>
      )}

      <ActionRequired matches={waitingOnMe} ladderOf={labels.forMatch} />

      <SectionTitle>All matches</SectionTitle>

      {matches.length > 0 && (
        <HistoryFilters
          filters={filters}
          games={gameOptions}
          formats={formatOptions}
          results={resultOptions}
          onChange={applyFilters}
        />
      )}

      {/* they both have the same msg, just updates differently */}
      {summary && <p className="text-xs text-text-secondary">{summary}</p>}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {historyQuery.isPending || historyQuery.isError ? null : (
        <>
          <HistoryMatches
            matches={current.rows}
            totalCount={matches.length}
            ladderOf={labels.forMatch}
            filtersActive={filtersActive}
            // Goes through `applyFilters`, never `setFilters`: clearing must also send the
            // reader back to page 1 and announce the table it lands on.
            onClearFilters={() => applyFilters(EMPTY_HISTORY_FILTERS)}
          />
          <Pagination
            page={current.page}
            pageCount={current.pageCount}
            onPageChange={goToPage}
            pageSize={pageSize}
            pageSizeOptions={HISTORY_PAGE_SIZES}
            onPageSizeChange={changePageSize}
            total={ordered.length}
            label="matches"
          />
        </>
      )}
    </div>
  );
}
