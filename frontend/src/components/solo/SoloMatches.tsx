import { MatchHistoryTable } from '@/components/matches/MatchHistoryTable';
import { matchOpponentView } from '@/lib/solo';
import { openDisputeCount } from '@/lib/match-history';

import type { Ref } from 'react';
import type { MatchHistoryRow } from '@/components/matches/MatchHistoryTable';
import type { SoloMatch } from '@/lib/solo';

type SoloMatchesProps = {
  matches: SoloMatch[] | undefined;
  isPending: boolean;
  isError: boolean;
  onCancelSlot?: (match: SoloMatch) => void;
  /**
   * Focus landing point after a slot is cancelled — see `MatchHistoryTable`. `HTMLElement`
   * because under `sm` it lands on the card list, not on the table's region.
   */
  historyRef?: Ref<HTMLElement>;
};

/**
 * Matches tab of /solo/$ladderId: adapter between GET /matches/me?ladderId= and the shared
 * MatchHistoryTable. Two differences from the team history, both simplifications:
 *   - no line-up column. in 1v1 the player IS the side and the route carries no line-up, so
 *     every row leaves `lineup` undefined and the table drops the column by itself.
 *   - every row can open its sheet. GET /matches/me only returns matches I'm in, so the guard
 *     on GET /matches/{id} can't refuse me — unlike a team history, which a non-member can read.
 */
export function SoloMatches({
  matches,
  isPending,
  isError,
  onCancelSlot,
  historyRef,
}: SoloMatchesProps) {
  if (isPending) {
    return <p className="text-sm text-text-muted">Loading your match history…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-text-secondary">
        Your match history could not be loaded. Reload the page to try again.
      </p>
    );
  }

  const list = matches ?? [];

  const rows: MatchHistoryRow<SoloMatch>[] = list.map((match) => ({
    match,
    // Not `match.opponent` directly: `null` has FOUR causes and two of them mean somebody
    // really played and then vanished (account deleted, team dissolved).
    opponent: matchOpponentView(match),
    canOpenSheet: true,
  }));

  return (
    <MatchHistoryTable
      rows={rows}
      disputes={openDisputeCount(list)}
      // No `disputeNoticeRole`: this screen already owns exactly ONE `role="status"` (the
      // page's announcement region).
      emptyMessage="No match yet on this ladder — open a slot and wait for someone to take it."
      footnote="Every row opens its match sheet: maps, Bo3 score and Elo change. The opponent’s name opens their player page."
      onCancelSlot={onCancelSlot}
      historyRef={historyRef}
    />
  );
}
