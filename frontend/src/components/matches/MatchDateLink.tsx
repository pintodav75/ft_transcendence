import { Link } from '@tanstack/react-router';

import { formatMatchDate } from '@/lib/match-detail';

type MatchDateLinkProps = {
  match: { id: string; scheduledAt: string | null };
  /** The other side's name, when there is one — it is what the accessible name announces. */
  opponentName?: string;
  /** A row/card the sheet guard would refuse renders the date as plain text, never a link. */
  canOpenSheet: boolean;
};

/**
 * The date of a match entry, carrying the link to its sheet.
 *
 * ⚠️ Extracted from `MatchRow` by [FX-TABLE], rule of the second use: `MatchCard` renders the
 * same date under `sm`. **The DOM is unchanged** — what mattered enough to share is the
 * accessible NAME (two entries of the same list naming the sheet differently is a reading
 * glitch) and the 24 px hit area, both of which drift the moment they exist twice.
 *
 * The date is the entry's KEYBOARD and screen-reader access to the sheet: the click handler on
 * the row/card is a convenience on top of it, never a replacement.
 */
export function MatchDateLink({ match, opponentName, canOpenSheet }: MatchDateLinkProps) {
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
      // height: WCAG 2.5.8 wants 24 px, and this link is a standalone target, not a word
      // inside a sentence — the "Inline" exception does not cover it.
      className="focus-ring -my-1.5 inline-flex items-center py-1.5 underline-offset-4 hover:underline"
    >
      {date}
    </Link>
  );
}
