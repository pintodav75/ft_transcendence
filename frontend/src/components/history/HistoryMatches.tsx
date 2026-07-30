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
  onClearFilters: () => void;
};

/**
 * The full list of `/history` — the adapter between `GET /matches/me` and the shared
 * `MatchHistoryTable`, exactly as `SoloMatches` and `TeamMatches` are for their screens.
 *
 * Two things are specific to this one:
 *   - **the Ladder column.** Every other consumer is scoped to a single ladder, so repeating
 *     it per row would be noise; here the rows come from different games and formats and the
 *     table is unreadable without it. It is opt-in and derived (`row.ladder !== undefined`),
 *     which is why the DOM of the other two screens is unchanged.
 *   - **no Actions column.** `onCancelSlot` is deliberately NOT passed: withdrawing a slot
 *     stays on the team page and on `/solo/$ladderId`, which already own the confirmation
 *     dialog and the focus restoration it needs. The column disappears on its own.
 *
 * Every row can open its sheet: `GET /matches/me` returns only matches I am a participant of
 * or whose team I belong to — which is precisely the guard of `GET /matches/{id}`, so it
 * cannot refuse me. Offering a row it would refuse would guarantee a 403 and a red console
 * line, and that is a project-rejection criterion.
 */
export function HistoryMatches({
  matches,
  totalCount,
  ladderOf,
  filtersActive,
  onClearFilters,
}: HistoryMatchesProps) {
  // 🚨 THE TWO EMPTY STATES SAY DIFFERENT THINGS, and conflating them is the classic dead
  // end: "no match" under an active filter reads as "you have never played", which sends the
  // user looking for a bug instead of at the four controls right above.
  if (matches.length === 0 && filtersActive && totalCount > 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="max-w-prose text-sm text-text-secondary">
          None of your {totalCount} matches match these filters. Widen them to see the rest —
          nothing has been lost.
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
          You have not played a match yet. Take an open slot and it will show up here — with
          its score, its Elo change and the sheet where the result is settled.
        </p>
        <Link to="/matchmaking" className={buttonClasses()}>
          Find a match
        </Link>
      </div>
    );
  }

  const rows: MatchHistoryRow<HistoryMatch>[] = matches.map((match) => ({
    match,
    // 🚨 Not `match.opponent` directly: `null` has FOUR causes and two of them mean somebody
    // really played and then vanished (account deleted, team dissolved). See its docblock.
    opponent: matchOpponentView(match),
    ladder: ladderOf(match),
    canOpenSheet: true,
  }));

  return (
    <MatchHistoryTable
      rows={rows}
      // ⚠️ DELIBERATELY 0 ON THIS SCREEN, and it is the one place where that is right. The
      // notice ("N matches in dispute, an admin has to settle it") exists to surface something
      // a team page would otherwise bury — but `/history` opens on a whole section that says
      // it louder, lists each one, links to its sheet, and cannot be hidden by a filter.
      // Showing both would state the same fact twice, and the table's copy would contradict
      // the section as soon as a filter narrowed the list.
      disputes={0}
      // ⚠️ No `disputeNoticeRole` either: this page owns no live region at all, and a region
      // mounted together with its content is not reliably announced (invariant #11).
      emptyMessage="You have not played a match yet."
      footnote="Every row opens its match sheet: maps, Bo3 score and Elo change. The opponent’s name opens their team or player page."
    />
  );
}
