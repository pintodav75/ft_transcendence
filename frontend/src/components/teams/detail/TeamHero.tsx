import { useId } from 'react';

import { GameImage } from '@/components/games/GameImage';
import { Avatar } from '@/components/ui/avatar';
import { Stat, StatStrip } from '@/components/ui/stat';
import { formatRecord } from '@/lib/ladders';
import { ROSTER_LIMIT, ladderSubtitle } from '@/lib/team-detail';
import { EM_DASH } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { RankingEntry } from '@/lib/ladders';
import type { TeamDetail } from '@/lib/team-detail';

type TeamHeroProps = {
  team: TeamDetail;
  gameName: string;
  memberCount: number;
  /**
   * The team's ladder line, or `undefined` when the team has no line yet — a line is
   * created by the FIRST match result, not by team creation. "No line" and "still
   * loading" must not look alike, hence the two flags below.
   */
  standing: RankingEntry | undefined;
  ladderSize: number;
  rankingsPending: boolean;
  rankingsError: boolean;
  /**
   * Role-dependent buttons rendered in the identity row ("Edit team" for the captain,
   * "Leave team" for a plain member, nothing for a visitor). The header stays ignorant
   * of who is looking: the PAGE knows the role, this component only reserves the slot.
   */
  actions?: ReactNode;
};

// "Dossier" header: game artwork, team identity, then the stats strip. Elo, record and
// rank come from the LADDER RANKINGS, not from GET /teams/{id}.
//
// ⚠️ The stats strip itself moved to `components/ui/stat-strip.tsx` ([F-SOLO]): it is handed
// plain strings and knows nothing of teams, so it belongs in `ui/`. The identity row above it
// deliberately stayed — a solo header shows an avatar and a pseudo, which is a different row,
// not a parameter of this one.
export function TeamHero({
  team,
  gameName,
  memberCount,
  standing,
  ladderSize,
  rankingsPending,
  rankingsError,
  actions,
}: TeamHeroProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-subtle"
    >
      <div className="relative h-40 sm:h-44">
        <GameImage gameId={team.gameId} name={gameName} className="size-full object-cover" />
        {/* Readability gradient, bottom to top — same idiom as TeamCard. */}
        <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
      </div>

      <div className="relative -mt-14 flex flex-wrap items-end gap-4 px-4 pb-5 sm:px-6">
        <Avatar
          src={team.logoUrl ?? undefined}
          alt=""
          fallback={team.name.slice(0, 2).toUpperCase()}
          className="size-20 shrink-0 ring-4 ring-background-app"
        />
        <div className="min-w-0">
          <h1 id={headingId} className="truncate text-3xl label-caps-black sm:text-4xl">
            {team.name}
          </h1>
          <p className="mt-2 text-xs label-caps text-text-secondary">
            {[gameName, team.format, ladderSubtitle(team.ladderName, gameName, team.format)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {/* `ml-auto` pushes the actions to the trailing edge on a wide viewport; the
            wrapping row drops them onto their own line below ~500 px instead of
            squeezing the team name. */}
        {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <StatStrip
        note={
          <>
            {!rankingsPending && !rankingsError && !standing && (
              <p className="px-6 py-3 text-xs text-text-secondary">
                Not ranked yet — a ladder line is created by this team&apos;s first match result.
              </p>
            )}
            {rankingsError && (
              <p className="px-6 py-3 text-xs text-text-secondary">
                Ladder standings could not be loaded.
              </p>
            )}
          </>
        }
      >
        <Stat label="Elo" value={standing ? String(standing.elo) : EM_DASH} />
        <Stat
          label="Record"
          value={standing ? formatRecord(standing.wins, standing.losses) : EM_DASH}
        />
        <Stat
          label="Rank"
          value={standing ? `#${standing.rank}` : EM_DASH}
          extra={standing ? `/ ${ladderSize}` : undefined}
        />
        <Stat label="Roster" value={String(memberCount)} extra={`/ ${ROSTER_LIMIT}`} />
      </StatStrip>
    </section>
  );
}
