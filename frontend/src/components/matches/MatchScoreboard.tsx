import { Link } from '@tanstack/react-router';
import { Trophy } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { eloDeltaClass } from '@/components/matches/match-status';
import { useBackFrom } from '@/lib/back-navigation';
import {
  formatEloDelta,
  formatSideScore,
  isSoloMatch,
  sideAvatarUrl,
  sideInitials,
  sideName,
} from '@/lib/match-detail';
import { MIN_LEAD_MINUTES } from '@/lib/match-slots';
import { EM_DASH, cn } from '@/lib/utils';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchScoreboardProps = {
  match: MatchSheet;
  sides: MatchSide[];
};

const identityLinkClasses =
  'group focus-ring flex min-w-0 flex-col items-center gap-3 rounded-card underline-offset-4';

/** One camp of the sheet. */
function MatchSideCard({
  side,
  isWinner,
  solo,
}: {
  side: MatchSide;
  isWinner: boolean;
  solo: boolean;
}) {
  const backFrom = useBackFrom();
  const name = sideName(side, solo);
  // On a 1v1 the PLAYER is the camp, so the link goes to his profile instead of a team page
  // that does not exist.
  const player = !side.team && solo ? side.players[0] : undefined;

  const identity = (
    <>
      <Avatar
        src={sideAvatarUrl(side, solo)}
        alt=""
        fallback={sideInitials(side, solo)}
        className="size-16 shrink-0"
      />

      <span className="min-w-0 text-lg font-bold text-text-primary group-hover:underline sm:text-xl">
        <span className="line-clamp-2 wrap-break-word">{name}</span>
      </span>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col items-center gap-3 text-center">
      {side.team ? (
        <Link to="/teams/$teamId" params={{ teamId: side.team.id }} className={identityLinkClasses}>
          {identity}
        </Link>
      ) : player ? (
        <Link
          to="/players/$pseudo"
          params={{ pseudo: player.pseudo }}
          // Names what the player page goes back to (this match sheet).
          state={backFrom}
          className={identityLinkClasses}
        >
          {identity}
        </Link>
      ) : (
        // Neither a team nor a player: nothing to link to, so no empty <a>.
        <div className="flex min-w-0 flex-col items-center gap-3">{identity}</div>
      )}

      {isWinner && (
        <Pill tone="win">
          <Trophy aria-hidden="true" className="size-3" />
          Winner
        </Pill>
      )}

      <p className={cn('font-mono text-sm font-bold tabular-nums', eloDeltaClass(side.eloDelta))}>

        <span className="sr-only">Elo change: </span>
        {formatEloDelta(side.eloDelta)}
        {side.eloAfter !== null && (
          <span className="ml-2 font-normal text-text-muted">({side.eloAfter} Elo)</span>
        )}
      </p>
    </div>
  );
}

/** What a screen reader hears in place of the big "2 – 1". */
function scoreLabel(home: MatchSide, away: MatchSide, solo: boolean) {
  const names = [sideName(home, solo), sideName(away, solo)];
  if (home.score === null && away.score === null) return `${names[0]} vs ${names[1]}, no score yet`;
  return `${names[0]} ${formatSideScore(home)}, ${names[1]} ${formatSideScore(away)}`;
}

/** The two camps face to face, Bo3 score in the middle. */
export function MatchScoreboard({ match, sides }: MatchScoreboardProps) {
  const [home, away] = sides;
  if (!home) return null;

  const solo = isSoloMatch(match);
  // Having no second side does NOT mean the slot is still takeable.
  const isOpenSlot = match.status === 'pending';

  return (
    // One column below `sm` (two 5v5 team names side by side at 375 px left ~120 px each),
    // three from `sm` up.
    <section
      aria-label="Score"
      className="grid grid-cols-1 items-center gap-6 rounded-card border border-border-subtle bg-surface-card p-5 sm:grid-cols-[1fr_auto_1fr] sm:gap-4"
    >
      <MatchSideCard side={home} isWinner={match.winnerSideId === home.id} solo={solo} />

      <div className="flex flex-col items-center gap-1">
        {away ? (
          // The visible "2 – 1" says nothing about WHOSE 2 it is once read out of the layout,
          // which is exactly what a screen reader does — hence the spelled-out label.
          <p
            role="img"
            aria-label={scoreLabel(home, away, solo)}
            className="font-mono text-4xl font-bold tabular-nums text-text-primary"
          >
            <span aria-hidden="true">
              {formatSideScore(home)}
              <span className="mx-2 text-text-muted">–</span>
              {formatSideScore(away)}
            </span>
          </p>
        ) : (
          <p className="font-mono text-4xl font-bold tabular-nums text-text-muted">{EM_DASH}</p>
        )}
        <p className="text-xs label-caps text-text-muted">
          {away ? 'Games won (Bo3)' : isOpenSlot ? 'No opponent yet' : 'No opponent'}
        </p>
      </div>

      {away ? (
        <MatchSideCard side={away} isWinner={match.winnerSideId === away.id} solo={solo} />
      ) : isOpenSlot ? (
        <p className="text-center text-sm text-text-secondary">
          Nobody has taken this slot yet. Any team of the ladder can accept it until{' '}
          {MIN_LEAD_MINUTES} minutes before kick-off.
        </p>
      ) : (
        <p className="text-center text-sm text-text-secondary">
          This slot never found an opponent, and can no longer be taken.
        </p>
      )}
    </section>
  );
}
