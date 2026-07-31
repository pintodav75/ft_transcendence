import { MatchCard } from '@/components/matches/MatchCard';
import { MatchRow } from '@/components/matches/MatchRow';
import { useMediaQuery } from '@/hooks/use-media-query';

import type { ReactNode, Ref } from 'react';
import type { MatchHistoryMatch } from '@/components/matches/MatchRow';
import type { MatchOpponentView } from '@/lib/match-history';

/**
 * The match history of a screen: header, one entry per match, dispute notice and footnote.
 *
 * ⚠️ MOVED from `components/teams/detail/TeamMatches.tsx` by [F-SOLO] (rule of the second
 * use). **The DOM it renders for a team is unchanged**; what left the component is the PROSE
 * (empty state, footnote) and the two derivations that depended on a team payload, both of
 * which are now the caller's job. `TeamMatches` and `SoloMatches` are the two thin adapters.
 *
 * 🚨 [FX-TABLE] — TWO LAYOUTS, ONE TREE. From `sm` up it is the table it has always been,
 * to the node. Below `sm` the table is REPLACED by a list of `MatchCard`s: at 375 px it left
 * 426 px of itself outside the viewport, so the opponent and the status sat behind a
 * horizontal scroll on the three screens that use it.
 *
 * The switch is a JS media query, NOT a `sm:hidden` / `hidden sm:block` pair, and that is a
 * hard constraint: mounting both trees would make every `getByText` of the eight audit
 * scenarios match two nodes, including at 1280 px where nothing is supposed to change — and
 * would hand a screen reader the whole history twice. `useMediaQuery` reads `matchMedia`
 * synchronously, so the first render is already the right one (no flash, no double render).
 *
 * Entering a result and attaching dispute evidence stay out: both need the winning SIDE's id,
 * which neither history route exposes — they belong to `/matches/$matchId`.
 */

/**
 * Tailwind's `sm` is 40rem and is NOT overridden in `index.css`: this is the last width under
 * it (39.9375rem = 639px at the default root size).
 *
 * ⚠️ IN `rem`, NOT IN `px`, and the two are not the same promise: `sm:` resolves against the
 * user's root font size, so a reader who enlarges it — a common accessibility setting — would
 * see the breakpoint move while a pixel query stayed put. No `sm:` class lives in these two
 * components today, so nothing would break yet; the point is that it cannot start to.
 */
const NARROW_QUERY = '(max-width: 39.9375rem)';

export type MatchHistoryRow<M extends MatchHistoryMatch> = {
  match: M;
  opponent: MatchOpponentView;
  /** My side's line-up, already formatted. `undefined` = this payload carries none. */
  lineup?: string;
  /**
   * [F-HIST] — the ladder this row was played on. `undefined` = the caller's screen is
   * already scoped to a single ladder, and the column disappears on its own. See `showLadder`
   * below for why it is derived and not a prop.
   */
  ladder?: { game: string; format: string };
  canOpenSheet: boolean;
};

type MatchHistoryTableProps<M extends MatchHistoryMatch> = {
  rows: MatchHistoryRow<M>[];
  /**
   * How many matches are waiting on an admin. `0` hides the notice — which is also how the
   * team page hides it from a non-member, who has no business being told.
   */
  disputes: number;
  /**
   * ⚠️ PRE-EXISTING DEBT, OPT-IN ON PURPOSE. The team page has passed `role="status"` on this
   * notice since FT-2A, which gives that screen a SECOND live region next to the page's own —
   * and `[role=status]` selectors take `.first()` (invariant #11). Removing it is out of this
   * ticket's scope and would touch an asserted DOM, so it stays exactly where it was; the
   * default is the safe one, and any new screen (the solo page) simply does not ask for it.
   */
  disputeNoticeRole?: 'status';
  /** Shown instead of the table when there is nothing to list. */
  emptyMessage: string;
  /** Explains where the row's two click targets lead. */
  footnote: ReactNode;
  onCancelSlot?: (match: M) => void;
  /**
   * Handle on the match history, used as the focus landing point after a slot is cancelled
   * (cf. `ConfirmDialog.returnFocusRef`): the entry that carried the button disappears, and
   * this element NAMES the list it came from.
   *
   * ⚠️ `HTMLElement` and not `HTMLDivElement` since [FX-TABLE]: what it lands on depends on
   * the viewport — the scrolling `<div role="region">` of the table, or the `<ul>` of the card
   * list, which exists at widths where that region does not. Both are only ever `.focus()`ed.
   */
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

  // Derived from the DATA, not from a role: `lineup` is ABSENT (not null) for a non-member
  // and for every solo row, and an empty column header would be a lie.
  const showLineup = rows.some((row) => row.lineup !== undefined);
  // Same rule, same reason ([F-HIST]): the two screens that were already using this table are
  // each scoped to ONE ladder and never set `ladder`, so their DOM is byte-for-byte what it
  // was. Only `/history` mixes ladders, and only there does the column appear.
  const showLadder = rows.some((row) => row.ladder !== undefined);
  const showActions = Boolean(onCancelSlot);

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
        /*
          Under `sm` there is no table, so there is nothing to scroll sideways and no scroll
          container to make focusable — the `tabIndex={0}` region of the other branch exists
          only for that.
          The list still has to be FOCUSABLE, though: it is where the focus lands when a
          cancelled slot takes its button out of the DOM — `tabIndex={-1}` makes it a
          programmatic target without adding a stop to the tab order.

          `role="list"` is explicit on purpose: Safari drops the list semantics of a `<ul>`
          whose display is changed (repo rule), and this one is a flex column.
        */
        <ul
          // React types a ref by the TAG it is attached to, while this one is only ever
          // `.focus()`ed and lands on whichever of the two layouts is mounted (see the
          // `historyRef` docblock). Narrowing `HTMLElement` back to the tag is the whole
          // content of this assertion — no behaviour depends on it.
          ref={historyRef as Ref<HTMLUListElement>}
          tabIndex={-1}
          role="list"
          aria-label="Match history, most recent first"
          className="focus-ring flex flex-col gap-3"
        >
          {rows.map((row) => (
            <MatchCard
              key={row.match.id}
              match={row.match}
              opponent={row.opponent}
              lineup={row.lineup}
              showLineup={showLineup}
              ladder={row.ladder}
              showLadder={showLadder}
              showActions={showActions}
              onCancelSlot={onCancelSlot}
              canOpenSheet={row.canOpenSheet}
            />
          ))}
        </ul>
      ) : (
        /*
          The table scrolls inside its own box: the page itself never scrolls sideways. It is
          focusable and labelled on purpose — between `sm` and ~600px of column the Status
          column can sit outside the viewport, and a scroll container that cannot take focus
          makes its hidden content unreachable by keyboard (WCAG 2.1.1).

          ⚠️ `relative` is LOAD-BEARING, not decoration. `sr-only` is `position: absolute`, and
          an absolutely positioned box is only clipped by an ancestor that is its CONTAINING
          BLOCK. With a static container, the screen-reader-only text of the Actions header
          (a 1 px box laid out ~628 px in, i.e. past the viewport) resolved against the initial
          containing block and stretched the DOCUMENT's scroll width by 253 px at 375 px —
          measured. Making this box positioned brings those descendants back under its
          overflow, which is what keeps the page itself from scrolling sideways.
        */
        <div
          // Same assertion as the card list above, same reason.
          ref={historyRef as Ref<HTMLDivElement>}
          tabIndex={0}
          role="region"
          aria-label="Match history, scroll sideways to see every column"
          className="focus-ring relative overflow-x-auto"
        >
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
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
                  // No visible label: the column holds one self-describing button and a
                  // header would only eat width. The name still exists for a screen reader.
                  <th scope="col" className="px-3 pb-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <MatchRow
                  key={row.match.id}
                  match={row.match}
                  opponent={row.opponent}
                  lineup={row.lineup}
                  showLineup={showLineup}
                  ladder={row.ladder}
                  showLadder={showLadder}
                  showActions={showActions}
                  onCancelSlot={onCancelSlot}
                  canOpenSheet={row.canOpenSheet}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-text-muted">{footnote}</p>
    </div>
  );
}
