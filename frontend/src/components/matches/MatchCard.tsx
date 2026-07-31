import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { InlineButton } from '@/components/ui/inline-button';
import { MatchDateLink } from '@/components/matches/MatchDateLink';
import { MatchOpponentLink } from '@/components/matches/MatchOpponentLink';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { eloDeltaClass, matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { opensMatchSheet } from '@/components/matches/match-sheet-click';
import { formatEloDelta, formatMatchDate } from '@/lib/match-detail';
import { formatScore, isCancellableSlot } from '@/lib/match-history';
import { EM_DASH, cn } from '@/lib/utils';

import type { MatchHistoryMatch, MatchRowProps } from '@/components/matches/MatchRow';

/**
 * One entry of a match history, as a CARD — what `MatchHistoryTable` mounts under `sm` instead
 * of `MatchRow` ([FX-TABLE]).
 *
 * 🚨 ONE TREE IN THE DOM, NEVER TWO. This is not a `sm:hidden` twin of the row: the table
 * mounts exactly one of the two (`useMediaQuery`), because duplicating the markup would make
 * every `getByText` of the eight audit scenarios match two nodes — including at 1280 px, where
 * nothing is supposed to change.
 *
 * 🔑 WHY A CARD AT ALL: at 375 px the table left 426 px of itself outside the viewport, so the
 * opponent and the status — the two things a history is read for — sat behind a horizontal
 * scroll. A card lays the same fields out vertically, and since there is no column header left
 * to explain them, EVERY value carries its own label (a bare "2–0" says nothing).
 *
 * It takes `MatchRowProps` as-is, deliberately: the table picks one component or the other by
 * viewport, and a prop honoured by only one of them would be a silent difference of behaviour
 * between the desktop and the mobile rendering of the same list.
 */
export function MatchCard<M extends MatchHistoryMatch>({
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
  // A finished match is the only one carrying a RESULT — that is what drives the entry's
  // emphasis, and it is deliberately NOT the same question as "can it be opened".
  const hasResult = match.status === 'completed';
  const opponentName = opponent?.name;
  const disputed = match.disputeStatus === 'open' || match.status === 'disputed';
  const eloDelta = match.eloDelta;
  // Same rule as the row: only the NEUTRAL parts are toned down. Dimming the whole card would
  // take the status pill down with it, and the "Disputed" pill is the one thing the design
  // wants to shout.
  const muted = hasResult ? undefined : 'opacity-70';

  return (
    <li>
      <Card
        // Same three guards as the row (`opensMatchSheet`): the whole card is a convenience
        // target, the date link below is the real keyboard access to the sheet.
        onClick={
          canOpenSheet
            ? (event) => {
                if (!opensMatchSheet(event)) return;
                void navigate({ to: '/matches/$matchId', params: { matchId: match.id } });
              }
            : undefined
        }
        className={cn(
          // The coloured left edge is the row's accent, kept so a slot / a live match / a
          // dispute reads the same on both layouts. `border-l-transparent` (the quiet tones)
          // simply shows the card's own background — nothing is cut out.
          'flex flex-col gap-3 border-l-2 p-3',
          matchAccentClass(tone),
          /*
            🚨 THE DISPUTE TINT IS AN OVERLAY, NOT A BACKGROUND, and that is not a detail.
            `cn()` is `twMerge`: a `bg-*` passed here REPLACES `Card`'s own `bg-surface-card/84`
            instead of stacking on it (measured — the class simply disappeared from the merged
            list), so the one card the design wants to shout came out hollow: a shadow with no
            surface, refilled on hover by `hover:bg-surface-card`. It worked on a `<tr>` only
            because a row has no surface of its own and the tint landed on the page.

            So the tint is painted by a pseudo-element instead: `-z-10` puts it ABOVE the card's
            background and UNDER the content (CSS paints negative-z descendants right after the
            element's own background), which is exactly what the row's `bg-arena-red/5` did, and
            `isolate` keeps that negative layer from escaping behind the page. `hover:` then
            needs no special case: the hover changes the surface, the tint stays on top of it.
            Same 5 % of the same token as the row, so both layouts tint by the same amount.
          */
          disputed &&
            'relative isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-card before:bg-arena-red/5',
          canOpenSheet && 'cursor-pointer hover:bg-surface-card',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className={cn('font-mono text-xs text-text-secondary', muted)}>
            <MatchDateLink match={match} opponentName={opponentName} canOpenSheet={canOpenSheet} />
          </span>
          <MatchStatusPill match={match} />
        </div>

        {/* THE information of the card, and the reason the ticket exists: on a phone the
            opponent was the first thing pushed off screen. `break-words` because a 30-character
            team name has nowhere to go at 375 px. */}
        <p className={cn('text-base font-bold break-words', muted)}>
          <MatchOpponentLink opponent={opponent} />
        </p>

        {/* A description list, not a grid of divs: without a column header, "Score" and the
            score it names have to be tied together for a screen reader too. */}
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {showLadder && (
            <div className="min-w-0">
              {/* ⚠️ NOT `text-text-muted`: that token measures 4.23:1 on a card, under AA, and
                  is already a ticketed debt with 45 usages. `text-text-secondary` is 7.81:1
                  and gives the same "this is only a label" hierarchy. */}
              <dt className="label-caps text-text-secondary">Ladder</dt>
              <dd className={cn('font-semibold break-words text-text-primary', muted)}>
                {ladder ? `${ladder.game} · ${ladder.format}` : EM_DASH}
              </dd>
            </div>
          )}

          {showLineup && (
            <div className="min-w-0">
              <dt className="label-caps text-text-secondary">Line-up</dt>
              <dd className={cn('font-mono break-words text-text-secondary', muted)}>
                {lineup ?? EM_DASH}
              </dd>
            </div>
          )}

          <div>
            <dt className="label-caps text-text-secondary">Score</dt>
            <dd className="font-mono font-bold tabular-nums">{formatScore(match.score)}</dd>
          </div>

          <div>
            <dt className="label-caps text-text-secondary">Elo</dt>
            <dd className={cn('font-mono font-bold tabular-nums', eloDeltaClass(eloDelta))}>
              {formatEloDelta(eloDelta)}
            </dd>
          </div>
        </dl>

        {/* An accepted match cannot be cancelled: offering the button would guarantee a 409
            and a red line in the console. */}
        {showActions && onCancelSlot && isCancellableSlot(match) ? (
          <div className="flex justify-end">
            <InlineButton
              tone="danger"
              onClick={() => onCancelSlot(match)}
              aria-label={`Cancel the slot of ${formatMatchDate(match.scheduledAt, 'long')}`}
            >
              <X aria-hidden="true" className="size-3" />
              Cancel
            </InlineButton>
          </div>
        ) : null}
      </Card>
    </li>
  );
}
