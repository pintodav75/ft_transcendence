/**
 * What ONE entry of a match history shares between its two layouts, `MatchRow` (table, from
 * `sm` up) and `MatchCard` (below it): payload shape, props, derived state, the date and
 * opponent cells, the withdraw button.
 */

import { Link, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { InlineButton } from '@/components/ui/inline-button';
import { matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { useBackFrom } from '@/lib/back-navigation';
import { formatMatchDate } from '@/lib/match-detail';
import { isCancellableSlot } from '@/lib/match-history';
import { EM_DASH } from '@/lib/utils';

import type { MouseEvent } from 'react';
import type { MatchOpponentView } from '@/lib/match-history';

/**
 * `py-1.5` lifts every line fragment of the name from 16 px to 28 px without breaking the wrap
 * (an `inline-flex` would).
 */
const opponentLinkClasses = 'focus-ring py-1.5 underline-offset-4 hover:underline';

// Structural rather than one API type: `GET /teams/{id}/matches` and `GET /matches/me` serve
// different shapes of the same idea.
export type MatchHistoryMatch = {
  id: string;
  status: string;
  scheduledAt: string | null;
  score: { self: number | null; opponent: number | null };
  eloDelta: number | null;
  disputeStatus?: 'open' | 'resolved' | null;
  opponent: object | null;
};

export type MatchEntryProps<M extends MatchHistoryMatch> = {
  match: M;
  /** Who to show as the opponent, already normalised by the caller. */
  opponent: MatchOpponentView;
  lineup?: string;
  showLineup: boolean;
  ladder?: { game: string; format: string };
  showLadder: boolean;
  showActions?: boolean;
  onCancelSlot?: (match: M) => void;
  canOpenSheet?: boolean;
};

// Whether a click on the entry's background should open the match sheet.
function opensMatchSheet(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return false;
  }

  if (
    event.target instanceof Element &&
    event.target.closest('a,button,input,select,textarea,summary,[role="button"]')
  ) {
    return false;
  }

  return Boolean(window.getSelection()?.isCollapsed);
}

/* eslint-disable-next-line react-refresh/only-export-components --
   the hook and the one button belong to the entry they describe; splitting them would trade
   a warning for a third file. */
export function useMatchEntry<M extends MatchHistoryMatch>({
  match,
  opponent,
  canOpenSheet = false,
}: Pick<MatchEntryProps<M>, 'match' | 'opponent' | 'canOpenSheet'>) {
  const navigate = useNavigate();

  return {
    /** Coloured left edge, so a slot / a live match / a dispute reads the same on both layouts. */
    accentClass: matchAccentClass(matchStatusView(match).tone),
    disputed: match.disputeStatus === 'open' || match.status === 'disputed',
    opponentName: opponent?.name,
    /** Only the NEUTRAL parts of an entry without a result are toned down. */
    muted: match.status === 'completed' ? undefined : 'opacity-70',
    onEntryClick: canOpenSheet
      ? (event: MouseEvent<HTMLElement>) => {
          if (!opensMatchSheet(event)) return;
          void navigate({ to: '/matches/$matchId', params: { matchId: match.id } });
        }
      : undefined,
  };
}

/**
 * Withdraw a slot nobody has taken. An accepted match cannot be cancelled: offering the button
 * would guarantee a 409 and a red line in the console.
 */
/**
 * The date is the entry's KEYBOARD and screen-reader access to the sheet: the click handler on
 * the entry itself is a convenience on top of it, never a replacement.
 */
export function MatchDateLink({
  match,
  opponentName,
  canOpenSheet,
}: {
  match: { id: string; scheduledAt: string | null };
  opponentName?: string;
  canOpenSheet: boolean;
}) {
  const date = formatMatchDate(match.scheduledAt);

  if (!canOpenSheet) return <>{date}</>;

  return (
    <Link
      to="/matches/$matchId"
      params={{ matchId: match.id }}
      // Both branches read the LONG date: two sibling labels of the same column in two
      // different formats is a reading glitch for anyone browsing the column by voice.
      aria-label={
        opponentName
          ? `Match sheet against ${opponentName}, ${formatMatchDate(match.scheduledAt, 'long')}`
          : `Match sheet of the slot of ${formatMatchDate(match.scheduledAt, 'long')}`
      }
      // `-my-1.5 py-1.5` lifts the hit area from 14 px to 26 px WITHOUT changing the row's
      // height: WCAG 2.5.8 wants 24 px, and this link is a standalone target, not a word inside
      // a sentence — the "Inline" exception does not cover it.
      className="focus-ring -my-1.5 inline-flex items-center py-1.5 underline-offset-4 hover:underline"
    >
      {date}
    </Link>
  );
}

/**
 * The opponent's NAME goes to the opponent's page, the rest of the entry to the match sheet:
 * clicking "Bravo" has to lead to Bravo.
 */
export function MatchOpponentLink({ opponent }: { opponent: MatchOpponentView }) {
  const backFrom = useBackFrom();

  if (opponent === null) {
    // Kept to a dash: the "Open slot" pill on the same entry already says nobody has accepted,
    // and a sentence here wrapped the row over three lines.
    return <span className="font-normal text-text-muted">{EM_DASH}</span>;
  }

  if (opponent.kind === 'team') {
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: opponent.id }}
        aria-label={`Team page of ${opponent.name}`}
        className={opponentLinkClasses}
      >
        {opponent.name}
      </Link>
    );
  }

  if (opponent.kind === 'user') {
    return (
      <Link
        to="/players/$pseudo"
        params={{ pseudo: opponent.pseudo }}
        // Names what the player page goes back to (this history).
        state={backFrom}
        aria-label={`Player page of ${opponent.name}`}
        className={opponentLinkClasses}
      >
        {opponent.name}
      </Link>
    );
  }

  return <span className="font-normal text-text-muted">{opponent.name}</span>;
}

export function CancelSlotButton<M extends MatchHistoryMatch>({
  match,
  onCancelSlot,
}: Pick<MatchEntryProps<M>, 'match' | 'onCancelSlot'>) {
  if (!onCancelSlot || !isCancellableSlot(match)) return null;

  return (
    <InlineButton
      tone="danger"
      onClick={() => onCancelSlot(match)}
      aria-label={`Cancel the slot of ${formatMatchDate(match.scheduledAt, 'long')}`}
    >
      <X aria-hidden="true" className="size-3" />
      Cancel
    </InlineButton>
  );
}
