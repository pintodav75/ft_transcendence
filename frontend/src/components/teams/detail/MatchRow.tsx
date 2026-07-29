import { Link, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { InlineButton } from '@/components/ui/inline-button';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { formatEloDelta, formatMatchDate } from '@/lib/match-detail';
import { formatLineup, formatScore, isCancellableSlot } from '@/lib/team-detail';
import { EM_DASH, cn } from '@/lib/utils';

import type { TeamMatch } from '@/lib/team-detail';

type MatchRowProps = {
  match: TeamMatch;
  /** The whole column is dropped when no match carries a line-up (visitor response). */
  showLineup: boolean;
  /**
   * Whether the table has an actions column at all. Decided ONCE by the table (so every
   * `<td>` count matches its `<th>` count), not row by row.
   */
  showActions?: boolean;
  /** Captain only. A row that is not an open slot renders an empty cell, never a button. */
  onCancelSlot?: (match: TeamMatch) => void;
  /**
   * FT-4A — may this row open its match sheet?
   *
   * Decided ONCE by the table, from the server's own `isMember`: a member reaches the sheet
   * of EVERY match of his team (a slot he opened, a match being played, a dispute he is part
   * of), a visitor only of a completed one — which is exactly the guard of
   * `GET /matches/{id}`. Offering the others to a visitor would guarantee a 403 and a red
   * line in the console.
   */
  canOpenSheet?: boolean;
};

export function MatchRow({
  match,
  showLineup,
  showActions = false,
  onCancelSlot,
  canOpenSheet = false,
}: MatchRowProps) {
  const navigate = useNavigate();
  const { tone } = matchStatusView(match);
  // A finished match is the only one carrying a RESULT — that is what drives the row's
  // emphasis, and it is deliberately NOT the same question as "can it be opened".
  const hasResult = match.status === 'completed';
  const date = formatMatchDate(match.scheduledAt);
  const opponentName = match.opponent?.name;
  const disputed = match.disputeStatus === 'open' || match.status === 'disputed';
  const eloDelta = match.eloDelta;
  // A row without a result is toned down — but only its NEUTRAL cells. Dimming the whole
  // row also dimmed the status pill, and dropped the "Disputed" pill to 3.07:1 contrast:
  // the one row the design wants to shout became the least readable of the page.
  const muted = hasResult ? undefined : 'opacity-70';
  // The opponent's NAME goes to the opponent's page, the rest of the row to the match sheet.
  // Before this fix the name opened the match, which is exactly backwards: clicking "Bravo"
  // has to lead to Bravo. `opponent` is null on an open slot AND on a match whose other team
  // was dissolved afterwards, so the target is only offered when the team is really there.
  // ⚠️ This link is NOT gated on `canOpenSheet`: a non-member reading a match he is not part
  // of gets it too, which is right — a team page is readable by any logged-in account, so no
  // 403 is possible. Only the MATCH sheet has a participant guard.
  const opponent = match.opponent;

  // The DATE always carries the sheet link on a row that can open it. It is the row's keyboard
  // and screen-reader access — the row's click handler is a convenience on top of it, never a
  // replacement (a handler is not focusable and cannot be middle-clicked into a tab).
  const sheetParams = { matchId: match.id };

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
              // A modified click asks the BROWSER for something (new tab, new window) that
              // `navigate()` cannot give: it would silently replace the current page instead.
              // Left it inert rather than wrong — the date link honours all three. Middle click
              // fires `auxclick`, never `click`, so it is inert here for free.
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
                return;
              // Anything interactive inside the row keeps its own target: the opponent link and
              // the captain's Cancel button would otherwise both be swallowed by the row.
              // ⚠️ Keep this list in sync with what the row renders — a new control not listed
              // here is swallowed SILENTLY (no error, just a stray navigation).
              if (
                event.target instanceof Element &&
                event.target.closest('a,button,input,select,textarea,summary,[role="button"]')
              )
                return;
              // A user dragging across a pseudo or a score is selecting text, not navigating.
              // (A double-click still navigates: the first click lands before any selection
              // exists — no click-through-row pattern survives that, and it is not worth a
              // timer that would delay every honest click.)
              if (!window.getSelection()?.isCollapsed) return;
              void navigate({ to: '/matches/$matchId', params: sheetParams });
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
        {canOpenSheet ? (
          <Link
            to="/matches/$matchId"
            params={sheetParams}
            // Both branches read the LONG date: two sibling labels of the same column in two
            // different formats is a reading glitch for anyone browsing the column by voice.
            aria-label={
              opponentName
                ? `Match sheet against ${opponentName}, ${formatMatchDate(match.scheduledAt, 'long')}`
                : `Match sheet of the slot of ${formatMatchDate(match.scheduledAt, 'long')}`
            }
            // `-my-1.5 py-1.5` lifts the hit area from 14 px to 26 px WITHOUT changing the row's
            // height: WCAG 2.5.8 wants 24 px, and this link is a standalone target, not a word
            // inside a sentence — the "Inline" exception does not cover it.
            className="focus-ring -my-1.5 inline-flex items-center py-1.5 underline-offset-4 hover:underline"
          >
            {date}
          </Link>
        ) : (
          date
        )}
      </td>

      <td className={cn('px-3 py-3 font-bold', muted)}>
        {opponent ? (
          <Link
            to="/teams/$teamId"
            params={{ teamId: opponent.id }}
            aria-label={`Team page of ${opponent.name}`}
            // `py-1.5` lifts EVERY line fragment of the name from 16 px to 28 px without
            // breaking the wrap (an `inline-flex` would). It matters more than it looks: this
            // target is now adjacent, at 0 px, to the row itself — which leads SOMEWHERE ELSE.
            // A near miss used to land on inert background, it now changes page.
            className="focus-ring py-1.5 underline-offset-4 hover:underline"
          >
            {opponent.name}
          </Link>
        ) : (
          /* Kept to a dash: the "Open slot" pill on the same row already says nobody has
             accepted, and a sentence here wrapped the row over three lines. */
          <span className="font-normal text-text-muted">{EM_DASH}</span>
        )}
      </td>

      {showLineup && (
        <td className={cn('px-3 py-3 font-mono text-xs text-text-muted', muted)}>
          {/* Truncated on purpose: a long pseudo used to push the Status column out of
              the visible area, and the status is what the row is read for. */}
          <span
            className="block max-w-24 truncate"
            title={match.lineup ? formatLineup(match.lineup.self) : undefined}
          >
            {match.lineup ? formatLineup(match.lineup.self) : EM_DASH}
          </span>
        </td>
      )}

      <td className="px-3 py-3 font-mono font-bold tabular-nums whitespace-nowrap">
        {formatScore(match.score)}
      </td>

      <td
        className={cn(
          'px-3 py-3 text-right font-mono font-bold tabular-nums',
          eloDelta === null || eloDelta === 0
            ? 'text-text-muted'
            : eloDelta < 0
              ? 'text-arena-red'
              : 'text-success',
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
