import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { InlineButton } from '@/components/ui/inline-button';
import { MatchDateLink } from '@/components/matches/MatchDateLink';
import { MatchOpponentLink } from '@/components/matches/MatchOpponentLink';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { eloDeltaClass, matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { opensMatchSheet } from '@/components/matches/match-sheet-click';
import { formatEloDelta, formatMatchDate } from '@/lib/match-detail';
import { formatScore, isCancellableSlot } from '@/lib/match-history';
import { EM_DASH, cn } from '@/lib/utils';

import type { MatchOpponentView } from '@/lib/match-history';

/**
 * One row of a match history.
 *
 * ⚠️ MOVED from `components/teams/detail/` by [F-SOLO] (rule of the second use): the solo
 * ladder page lists MY matches in the very same table, and a solo page importing
 * "teams/detail" would say the opposite of what the code does. **The rendered DOM for a team
 * row is unchanged** — the only difference is that the opponent cell is now driven by a
 * normalised `opponent` prop instead of reading a team-shaped payload directly, because the
 * two routes do not describe an opponent the same way (see `MatchOpponentView`).
 *
 * ⚠️ [FX-TABLE] — this row is the DESKTOP half of a match history: under `sm`, `MatchCard`
 * renders the same entry as a card and this component is not mounted at all (one tree in the
 * DOM, never two). Everything the two halves must say identically left for its own module:
 * `MatchDateLink`, `MatchOpponentLink`, `opensMatchSheet`, `eloDeltaClass`. **The DOM of this
 * row is unchanged.**
 */

/**
 * What a row actually reads, described structurally rather than by one API type:
 * `GET /teams/{id}/matches` and `GET /matches/me` serve different shapes of the same idea.
 *
 * `opponent` is `object | null` because nothing HERE looks inside it — the row only asks
 * "is this still an open slot?" (`isCancellableSlot`) and lets `matchStatusView` do the same.
 * What to DISPLAY comes from the `opponent` prop below, which the caller has normalised.
 */
export type MatchHistoryMatch = {
  id: string;
  status: string;
  scheduledAt: string | null;
  score: { self: number | null; opponent: number | null };
  eloDelta: number | null;
  disputeStatus?: 'open' | 'resolved' | null;
  opponent: object | null;
};

/**
 * ⚠️ EXPORTED SINCE [FX-TABLE] and shared as-is with `MatchCard`: the table picks one of the
 * two by viewport, so a prop that existed on only one of them would be a silent difference of
 * behaviour between the desktop and the mobile rendering of the same list.
 */
export type MatchRowProps<M extends MatchHistoryMatch> = {
  match: M;
  /** Who to show in the Opponent cell, already normalised by the caller. */
  opponent: MatchOpponentView;
  /**
   * My side's line-up, ALREADY FORMATTED — `undefined` when this payload carries none (a
   * visitor's team history, or any solo row: in 1v1 the player *is* the side).
   */
  lineup?: string;
  /** The whole column is dropped when no row carries a line-up. */
  showLineup: boolean;
  /**
   * [F-HIST] — which ladder this row was played on. `undefined` on a screen that is ALREADY
   * scoped to one ladder (a team page, `/solo/$ladderId`), where repeating it on every line
   * would be noise. Only `/history` mixes ladders, and there the table is unreadable without
   * it.
   */
  ladder?: { game: string; format: string };
  /** Decided ONCE by the table, like `showLineup`, so every `<td>` matches a `<th>`. */
  showLadder: boolean;
  /**
   * Whether the table has an actions column at all. Decided ONCE by the table (so every
   * `<td>` count matches its `<th>` count), not row by row.
   */
  showActions?: boolean;
  /** A row that is not an open slot renders an empty cell, never a button. */
  onCancelSlot?: (match: M) => void;
  /**
   * FT-4A — may this row open its match sheet?
   *
   * Decided ONCE by the table. On a team history it comes from the server's own `isMember`: a
   * member reaches the sheet of EVERY match of his team, a visitor only of a completed one —
   * which is exactly the guard of `GET /matches/{id}`. On a solo history it is always true:
   * `GET /matches/me` returns only matches I am a participant of, so the guard cannot refuse
   * me. Offering a row the guard would refuse would guarantee a 403 and a red console line.
   */
  canOpenSheet?: boolean;
};

export function MatchRow<M extends MatchHistoryMatch>({
  match,
  opponent,
  lineup,
  showLineup,
  ladder,
  showLadder,
  showActions = false,
  onCancelSlot,
  canOpenSheet = false,
}: MatchRowProps<M>) {
  const navigate = useNavigate();
  const { tone } = matchStatusView(match);
  // A finished match is the only one carrying a RESULT — that is what drives the row's
  // emphasis, and it is deliberately NOT the same question as "can it be opened".
  const hasResult = match.status === 'completed';
  const opponentName = opponent?.name;
  const disputed = match.disputeStatus === 'open' || match.status === 'disputed';
  const eloDelta = match.eloDelta;
  // A row without a result is toned down — but only its NEUTRAL cells. Dimming the whole
  // row also dimmed the status pill, and dropped the "Disputed" pill to 3.07:1 contrast:
  // the one row the design wants to shout became the least readable of the page.
  const muted = hasResult ? undefined : 'opacity-70';

  return (
    <tr
      className={cn(
        'border-t border-border-subtle',
        disputed && 'bg-arena-red/5',
        canOpenSheet && 'cursor-pointer hover:bg-surface-card',
      )}
      onClick={
        canOpenSheet
          ? (event) => {
              // The three guards (modified click, control inside the row, text selection)
              // live in `opensMatchSheet` — `MatchCard` has to honour exactly the same ones.
              if (!opensMatchSheet(event)) return;
              void navigate({ to: '/matches/$matchId', params: { matchId: match.id } });
            }
          : undefined
      }
    >
      <td
        className={cn(
          'border-l-2 px-3 py-3 font-mono text-xs whitespace-nowrap text-text-secondary',
          matchAccentClass(tone),
          muted,
        )}
      >
        {/* The DATE always carries the sheet link on a row that can open it. It is the row's
            keyboard and screen-reader access — the row's click handler is a convenience on top
            of it, never a replacement (a handler is not focusable and cannot be middle-clicked
            into a tab). */}
        <MatchDateLink match={match} opponentName={opponentName} canOpenSheet={canOpenSheet} />
      </td>

      {showLadder && (
        // Two lines rather than one: the ladder's own name ("Counter-Strike 2 5v5") repeats
        // the format, and laying the game over it keeps the column narrow enough that the
        // Status column stays in view at the table's minimum width. `whitespace-nowrap`
        // because a wrapped game name would make the row twice as tall for nothing — the
        // table scrolls sideways in its own box when it has to.
        <td className={cn('px-3 py-3 whitespace-nowrap', muted)}>
          {/* ⚠️ NEITHER LINE IS `text-text-muted`. That token measures 4.23:1 on a card — below
              AA — and is already a ticketed design-system debt with 45 usages; a new column
              has no business adding a 46ᵗʰ. `text-text-primary` over `text-text-secondary`
              (7.81:1) gives the same hierarchy and passes. */}
          <span className="block text-xs font-semibold text-text-primary">
            {ladder?.game ?? EM_DASH}
          </span>
          <span className="block text-xs text-text-secondary">{ladder?.format ?? EM_DASH}</span>
        </td>
      )}

      <td className={cn('px-3 py-3 font-bold', muted)}>
        <MatchOpponentLink opponent={opponent} />
      </td>

      {showLineup && (
        <td className={cn('px-3 py-3 font-mono text-xs text-text-muted', muted)}>
          {/* Truncated on purpose: a long pseudo used to push the Status column out of
              the visible area, and the status is what the row is read for. */}
          <span className="block max-w-24 truncate" title={lineup}>
            {lineup ?? EM_DASH}
          </span>
        </td>
      )}

      <td className="px-3 py-3 font-mono font-bold tabular-nums whitespace-nowrap">
        {formatScore(match.score)}
      </td>

      <td
        className={cn(
          'px-3 py-3 text-right font-mono font-bold tabular-nums',
          eloDeltaClass(eloDelta),
        )}
      >
        {formatEloDelta(eloDelta)}
      </td>

      <td className="px-3 py-3 text-right whitespace-nowrap">
        <MatchStatusPill match={match} />
      </td>

      {showActions && (
        // Last column, no visible header (the buttons name themselves). `w-px` makes the
        // column collapse to its content so it never steals width from Opponent.
        <td className="w-px px-3 py-3 text-right whitespace-nowrap">
          {/* An accepted match cannot be cancelled: offering the button would guarantee a
              409 and a red line in the console. */}
          {onCancelSlot && isCancellableSlot(match) ? (
            <InlineButton
              tone="danger"
              onClick={() => onCancelSlot(match)}
              aria-label={`Cancel the slot of ${formatMatchDate(match.scheduledAt, 'long')}`}
            >
              <X aria-hidden="true" className="size-3" />
              Cancel
            </InlineButton>
          ) : null}
        </td>
      )}
    </tr>
  );
}
