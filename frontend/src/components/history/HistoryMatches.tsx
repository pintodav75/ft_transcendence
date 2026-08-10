import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { MatchHistoryTable } from '@/components/matches/MatchHistoryTable';
import { buttonClasses } from '@/components/ui/button-variants';
import { matchOpponentView } from '@/lib/solo';

import type { HistoryMatch, MatchLadderLabel } from '@/lib/history';
import type { MatchHistoryRow } from '@/components/matches/MatchHistoryTable';

type HistoryMatchesProps = {
  /** Already filtered by the page. */
  matches: HistoryMatch[];
  /** How many matches exist before any filter — tells the two empty states apart. */
  totalCount: number;
  ladderOf: (match: HistoryMatch) => MatchLadderLabel;
  filtersActive: boolean;
  /** Resets every filter*/
  onClearFilters: () => void;
};

export function HistoryMatches({
  matches,
  totalCount,
  ladderOf,
  filtersActive,
  onClearFilters,
}: HistoryMatchesProps) {
  if (matches.length === 0 && filtersActive && totalCount > 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="max-w-prose text-sm text-text-secondary">
          None of your {totalCount} matches match these filters.
        </p>
        <Button variant="secondary" onClick={onClearFilters}>
          Clear the filters
        </Button>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="max-w-prose text-sm text-text-secondary">
          You have not played a match yet. Take an open slot and it will show up here — with its
          score, its Elo change and the sheet where the result is settled.
        </p>
        <Link to="/matchmaking" className={buttonClasses()}>
          Find a match
        </Link>
      </div>
    );
  }

  const rows: MatchHistoryRow<HistoryMatch>[] = matches.map((match) => ({
    match,
    opponent: matchOpponentView(match),
    ladder: ladderOf(match),
    canOpenSheet: true,
  }));

  return (
    <MatchHistoryTable
      rows={rows}
      // 0 ON THIS SCREEN. `/history` already says the disputes
      disputes={0}
      emptyMessage="You have not played a match yet."
      footnote="Every row opens its match sheet: maps, Bo3 score and Elo change. The opponent’s name opens their team or player page."
    />
  );
}
