import { Link } from '@tanstack/react-router';
import { Trophy } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { formatEloDelta, sideAvatarUrl, sideInitials, sideName } from '@/lib/match-detail';
import { cn } from '@/lib/utils';

import type { MatchSide } from '@/lib/match-detail';

type MatchSideCardProps = {
  side: MatchSide;
  /** `match.winnerSideId === side.id` — decided by the scoreboard, which sees both sides. */
  isWinner: boolean;
  /**
   * `isSoloMatch(match)` — read from the LADDER'S FORMAT, passed down because a card only sees
   * its own side. A side without a team is NOT proof of 1v1: a dissolved team leaves the same
   * hole (`team_id` is `set null`), and treating that as solo linked a 5v5 camp to one player.
   */
  solo: boolean;
};

/**
 * One camp of the sheet: who it is, whether it won, and what this match cost or earned it.
 *
 * 🚨 The Elo shown here is the Elo of the CAMP, never of a player. A 5v5 result moves one
 * `rankings` line — the team's — and splitting it across five names would invent a number
 * the backend never computed.
 */
export function MatchSideCard({ side, isWinner, solo }: MatchSideCardProps) {
  const name = sideName(side, solo);
  // On a 1v1 the PLAYER is the camp, so the link goes to his profile instead of a team page
  // that does not exist. A teamless side on a TEAM ladder is a dissolved team, not a player:
  // it gets no link at all rather than one pointing at whoever happened to be listed first.
  const player = !side.team && solo ? side.players[0] : undefined;

  const identity = (
    <>
      <Avatar
        src={sideAvatarUrl(side, solo)}
        alt=""
        fallback={sideInitials(side, solo)}
        className="size-16 shrink-0"
      />
      <span className="min-w-0 text-lg font-bold text-text-primary sm:text-xl">
        <span className="line-clamp-2 break-words">{name}</span>
      </span>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col items-center gap-3 text-center">
      {side.team ? (
        <Link
          to="/teams/$teamId"
          params={{ teamId: side.team.id }}
          className="focus-ring flex min-w-0 flex-col items-center gap-3 rounded-card underline-offset-4 hover:underline"
        >
          {identity}
        </Link>
      ) : player ? (
        <Link
          to="/players/$pseudo"
          params={{ pseudo: player.pseudo }}
          className="focus-ring flex min-w-0 flex-col items-center gap-3 rounded-card underline-offset-4 hover:underline"
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

      <p
        className={cn(
          'font-mono text-sm font-bold tabular-nums',
          side.eloDelta === null || side.eloDelta === 0
            ? 'text-text-muted'
            : side.eloDelta < 0
              ? 'text-arena-red'
              : 'text-success',
        )}
      >
        {/* Never "0" when the match is not over: `formatEloDelta(null)` renders an em dash,
            because "no Elo yet" and "no Elo change" are different facts. */}
        <span className="sr-only">Elo change: </span>
        {formatEloDelta(side.eloDelta)}
        {side.eloAfter !== null && (
          <span className="ml-2 font-normal text-text-muted">({side.eloAfter} Elo)</span>
        )}
      </p>
    </div>
  );
}
