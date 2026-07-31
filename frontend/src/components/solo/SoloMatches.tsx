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
   * since [FX-TABLE]: under `sm` it lands on the card list, not on the table's region.
   */
  historyRef?: Ref<HTMLElement>;
};

/**
 * Matches tab of `/solo/$ladderId` — the adapter between `GET /matches/me?ladderId=` and the
 * shared `MatchHistoryTable`.
 *
 * Two things are structurally different from the team history, and both are simplifications:
 *   - **no line-up column.** In 1v1 the player IS the side; `GET /matches/me` carries no
 *     line-up at all, so every row leaves `lineup` undefined and the column disappears on
 *     its own (the table derives it from the rows).
 *   - **every row can open its sheet.** `GET /matches/me` only ever returns matches I am a
 *     participant of, so the guard of `GET /matches/{id}` cannot refuse me — unlike a team
 *     history, which a non-member may also read.
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
    // 🚨 Not `match.opponent` directly: `null` has FOUR causes and two of them mean somebody
    // really played and then vanished (account deleted, team dissolved). `matchOpponentView`
    // is what keeps an em dash from quietly erasing them — see its docblock.
    opponent: matchOpponentView(match),
    canOpenSheet: true,
  }));

  return (
    <MatchHistoryTable
      rows={rows}
      disputes={openDisputeCount(list)}
      // ⚠️ No `disputeNoticeRole`: this screen already owns exactly ONE `role="status"` (the
      // page's announcement region). A second one competes for the reading, and a
      // `[role=status]` selector takes `.first()` — invariant #11.
      emptyMessage="No match yet on this ladder — open a slot and wait for someone to take it."
      footnote="Every row opens its match sheet: maps, Bo3 score and Elo change. The opponent’s name opens their player page."
      onCancelSlot={onCancelSlot}
      historyRef={historyRef}
    />
  );
}
