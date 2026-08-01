import { Link } from '@tanstack/react-router';

import { GameIcon } from '@/components/games/GameIcon';
import {
  RowList,
  rowLinkClasses,
  rowNameClasses,
  rowTrailingClasses,
} from '@/components/ui/row-list';
import { SectionTitle } from '@/components/ui/section-title';
import { formatRecord } from '@/lib/ladders';
import { useBackFrom } from '@/lib/back-navigation';

import type { PlayerRanking } from '@/lib/player-detail';

type PlayerRankingsProps = {
  /** Already ordered by the API (most recently played ladder first) — never re-sorted here. */
  rankings: PlayerRanking[];
  /** Display name of the profile, for an empty state that names who it is talking about. */
  name: string;
};

/**
 * WHAT LEVEL this player is at, ladder by ladder — the one thing the profile did not say, on a
 * platform whose entire subject is exactly that.
 *
 * 🚨 AN EMPTY LIST IS THE NORMAL STATE OF A NEW ACCOUNT, not an anomaly and not an error. A
 * `rankings` row is born of the first match RESULT, never of an enrolment (there is no such
 * thing as joining a ladder), so the empty copy must read as "nothing played yet" and never as
 * "something is missing". Same asymmetry `/solo` is built around.
 *
 * ⚠️ `rank` and `ladderSize` come from the API and are NOT recomputed here. The backend
 * deliberately ranks with the very `ORDER BY` of `GET /ladders/{id}/rankings` (ties included),
 * because the row below links straight to that board: two ways of ordering would print "#3"
 * here and "#4" one click away, for the same person.
 */
export function PlayerRankings({ rankings, name }: PlayerRankingsProps) {
  // Tells the ladder page what it goes back to — this list is one of its entrances.
  const backFrom = useBackFrom();

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Rankings</SectionTitle>

      {rankings.length === 0 ? (
        // ⚠️ `text-text-secondary`, not `text-text-muted`: muted on a card measures 4,23:1,
        // under AA, and is already a ticketed debt of the design system.
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-sm text-text-secondary">
          {name} has not finished a ranked match yet. A ladder line appears with the first result.
        </p>
      ) : (
        <RowList>
          {rankings.map((ranking) => (
            <li key={ranking.ladderId}>
              <Link
                to="/ladders/$ladderId"
                params={{ ladderId: ranking.ladderId }}
                state={backFrom}
                // The row's cells are read as one string otherwise ("Chess 1v1 1560 30–9 #1
                // / 11"), which says nothing about what each number is. Same call as
                // `LadderRow`, whose visual column header is `aria-hidden` for the same reason.
                aria-label={`${ranking.ladderName}, ${ranking.elo} Elo, ${ranking.wins} wins ${ranking.losses} losses, rank ${ranking.rank} of ${ranking.ladderSize}`}
                className={rowLinkClasses}
              >
                {/* Decorative: the ladder's name sits right beside it and already carries the
                    game ("Chess 1v1"). `name` is only ever rendered by `GameAsset`'s fallback,
                    for a game whose artwork we do not ship yet. */}
                <GameIcon
                  gameId={ranking.gameId}
                  name={ranking.ladderName}
                  className="size-8 shrink-0 rounded-control object-cover"
                />
                <span className={rowNameClasses}>{ranking.ladderName}</span>
                <span className={`${rowTrailingClasses} font-mono text-xs tabular-nums`}>
                  <span className="font-bold text-text-primary">
                    {ranking.elo}
                    <span className="ml-1 font-normal text-text-muted">Elo</span>
                  </span>
                  <span className="text-text-secondary">
                    {formatRecord(ranking.wins, ranking.losses)}
                  </span>
                  {/* The denominator is what makes the rank mean anything: "#1" alone reads the
                      same on a ladder of two and a ladder of two hundred. */}
                  <span className="ml-auto text-text-secondary sm:ml-0">
                    #{ranking.rank}
                    <span className="ml-1 text-text-muted">/ {ranking.ladderSize}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </RowList>
      )}
    </section>
  );
}
