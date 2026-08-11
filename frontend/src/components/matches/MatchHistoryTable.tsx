/*
 * Match history of a screen: dispute notice, one entry per match, footnote.
 *
 * table from sm up, list of cards below — a JS media query, not a sm:hidden / hidden sm:block
 * pair: mounting both trees would hand a screen reader the whole history twice. useMediaQuery
 * reads matchMedia synchronously so the first render is already the right one.
 * entering a result and attaching evidence stay out — both need the winning side's id, which
 * neither history route serves. that's /matches/$matchId.
 */

import { MatchCard } from '@/components/matches/MatchCard';
import { MatchRow } from '@/components/matches/MatchRow';
import { useMediaQuery } from '@/hooks/use-media-query';

import type { ReactNode, Ref } from 'react';
import type { MatchHistoryMatch } from '@/components/matches/match-entry';
import type { MatchOpponentView } from '@/lib/match-history';

/** The last width under Tailwind's `sm` (40rem, not overridden in `index.css`). */
const NARROW_QUERY = '(max-width: 39.9375rem)';

export type MatchHistoryRow<M extends MatchHistoryMatch> = {
  match: M;
  opponent: MatchOpponentView;
  /** My side's line-up, already formatted. `undefined` = this payload carries none. */
  lineup?: string;
  /**
   * The ladder this row was played on. `undefined` = the caller's screen is already
   * scoped to a single ladder, and the column disappears on its own.
   */
  ladder?: { game: string; format: string };
  canOpenSheet: boolean;
};

type MatchHistoryTableProps<M extends MatchHistoryMatch> = {
  rows: MatchHistoryRow<M>[];
  /**
   * How many matches are waiting on an admin. `0` hides the notice — which is also how the team
   * page hides it from a non-member, who has no business being told.
   */
  disputes: number;
  /** PRE-EXISTING DEBT, OPT-IN ON PURPOSE. */
  disputeNoticeRole?: 'status';
  /** Shown instead of the table when there is nothing to list. */
  emptyMessage: string;
  /** Explains where the row's two click targets lead. */
  footnote: ReactNode;
  onCancelSlot?: (match: M) => void;
  /** Handle on the match history, used as the focus landing point after a slot is cancelled (cf. */
  historyRef?: Ref<HTMLElement>;
};

export function MatchHistoryTable<M extends MatchHistoryMatch>({
  rows,
  disputes,
  disputeNoticeRole,
  emptyMessage,
  footnote,
  onCancelSlot,
  historyRef,
}: MatchHistoryTableProps<M>) {
  const isNarrow = useMediaQuery(NARROW_QUERY);

  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">{emptyMessage}</p>;
  }

  // Derived from the DATA, not from a role: `lineup` is ABSENT (not null) for a non-member and
  // for every solo row, and an empty column header would be a lie.
  const showLineup = rows.some((row) => row.lineup !== undefined);
  // Same rule, same reason: the two screens that were already using this table are
  // each scoped to ONE ladder and never set `ladder`, so their DOM is byte-for-byte what it
  // was.
  const showLadder = rows.some((row) => row.ladder !== undefined);
  const showActions = Boolean(onCancelSlot);

  // The two layouts are fed the SAME entry, from one place: a prop set that drifted between
  // them would only show up at the viewport the reader is not using. NO `key` IN HERE.
  const entryProps = (row: MatchHistoryRow<M>) => ({
    match: row.match,
    opponent: row.opponent,
    lineup: row.lineup,
    showLineup,
    ladder: row.ladder,
    showLadder,
    showActions,
    onCancelSlot,
    canOpenSheet: row.canOpenSheet,
  });

  return (
    <div className="flex flex-col gap-4">
      {disputes > 0 && (
        <p
          role={disputeNoticeRole}
          className="rounded-card border border-arena-red/45 bg-arena-red-soft px-4 py-3 text-sm text-text-secondary"
        >
          <span className="font-semibold text-text-primary">
            {disputes === 1 ? '1 match in dispute.' : `${disputes} matches in dispute.`}
          </span>{' '}
          Both sides reported a different winner, so an admin has to settle it.
        </p>
      )}

      {isNarrow ? (
        /**
         * Under `sm` there is no table, so there is nothing to scroll sideways and no scroll
         * container to make focusable — the `tabIndex={0}` region of the other branch exists
         * only for that.
         */
        <ul
          // React types a ref by the TAG it is attached to, while this one is only ever
          // `.focus()`ed and lands on whichever of the two layouts is mounted (see the
          // `historyRef` docblock).
          ref={historyRef as Ref<HTMLUListElement>}
          tabIndex={-1}
          role="list"
          aria-label="Match history, most recent first"
          className="focus-ring flex flex-col gap-3"
        >
          {rows.map((row) => (
            <MatchCard key={row.match.id} {...entryProps(row)} />
          ))}
        </ul>
      ) : (
        /** The table scrolls inside its own box: the page itself never scrolls sideways. */
        <div
          // Same assertion as the card list above, same reason.
          ref={historyRef as Ref<HTMLDivElement>}
          tabIndex={0}
          role="region"
          aria-label="Match history, scroll sideways to see every column"
          className="focus-ring relative overflow-x-auto"
        >
          <table className="w-full min-w-xl border-collapse text-left text-sm">
            <caption className="sr-only">Match history, most recent first</caption>
            <thead>
              <tr className="text-xs label-caps text-text-muted">
                <th scope="col" className="px-3 pb-2.5 font-semibold">
                  Date
                </th>
                {showLadder && (
                  <th scope="col" className="px-3 pb-2.5 font-semibold">
                    Ladder
                  </th>
                )}
                <th scope="col" className="px-3 pb-2.5 font-semibold">
                  Opponent
                </th>
                {showLineup && (
                  <th scope="col" className="px-3 pb-2.5 font-semibold">
                    Line-up
                  </th>
                )}
                <th scope="col" className="px-3 pb-2.5 font-semibold">
                  Score
                </th>
                <th scope="col" className="px-3 pb-2.5 text-right font-semibold">
                  Elo
                </th>
                <th scope="col" className="px-3 pb-2.5 text-right font-semibold">
                  Status
                </th>
                {showActions && (
                  // No visible label: the column holds one self-describing button and a header
                  // would only eat width. The name still exists for a screen reader.
                  <th scope="col" className="px-3 pb-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MatchRow key={row.match.id} {...entryProps(row)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-text-muted">{footnote}</p>
    </div>
  );
}
