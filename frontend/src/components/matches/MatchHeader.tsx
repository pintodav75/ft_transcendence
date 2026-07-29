import { Swords } from 'lucide-react';

import { GameBanner } from '@/components/games/GameBanner';
import { MatchStatusPill } from '@/components/matches/MatchStatusPill';
import { Pill } from '@/components/ui/pill';
import { formatMatchDate, isSoloMatch, settledByAdmin, sideName } from '@/lib/match-detail';
import { ladderSubtitle } from '@/lib/team-detail';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchHeaderProps = {
  match: MatchSheet;
  sides: MatchSide[];
  /** Id of the `<h1>`, so the page can name its own landmark with it. */
  headingId: string;
};

/** "Team Alpha vs Team Bravo", or the lone side's own name while the slot has no taker. */
function matchTitle(sides: MatchSide[], match: MatchSheet) {
  const [home, away] = sides;
  if (!home) return 'Match';

  const solo = isSoloMatch(match);
  if (away) return `${sideName(home, solo)} vs ${sideName(away, solo)}`;
  // ⚠️ A single side is not proof the slot is still open — an expired slot is cancelled by the
  // job and keeps exactly this shape. Titling it "open slot" contradicts the CANCELLED pill
  // sitting two lines below it.
  return match.status === 'pending'
    ? `${sideName(home, solo)} — open slot`
    : `${sideName(home, solo)} — withdrawn slot`;
}

/**
 * Identity of the sheet: game artwork, who plays whom, on which ladder, when, in what state.
 *
 * The ladder, its format and the game's name come from the match payload itself (B16 serves
 * `match.ladder`), so the page needs no second round-trip to title itself.
 */
export function MatchHeader({ match, sides, headingId }: MatchHeaderProps) {
  const { ladder } = match;
  // Same rule as the team page: "Chess 1v1" next to "Chess · 1v1" reads three times the same
  // thing, so the ladder's name is only kept when it says something the two do not.
  const extraName = ladderSubtitle(ladder.name, ladder.gameName, ladder.format);

  return (
    <header className="space-y-1">
      <GameBanner
        gameId={ladder.gameId}
        name={ladder.gameName}
        className="-mx-6 -mt-6 mb-4 h-32 sm:h-36"
      />

      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <Swords aria-hidden="true" className="size-4" /> Match
      </p>

      <h1 id={headingId} className="text-3xl label-caps-black">
        {matchTitle(sides, match)}
      </h1>

      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs label-caps text-text-secondary">
        <span>{ladder.gameName}</span>
        <Pill tone="muted">{ladder.format}</Pill>
        {extraName && <span>{extraName}</span>}
        <span className="normal-case">{formatMatchDate(match.scheduledAt, 'long')}</span>
        {/* ⚠️ `opponent` is what tells "Open slot" from "Scheduled", and this payload has no
            such field: on the sheet, having an opponent IS having a second side. Passing
            `match` alone would label every accepted-but-not-started match an open slot. */}
        <MatchStatusPill
          match={{
            status: match.status,
            opponent: sides[1] ? { id: sides[1].id } : null,
          }}
          adminSettled={settledByAdmin(match, sides)}
        />
      </div>
    </header>
  );
}
