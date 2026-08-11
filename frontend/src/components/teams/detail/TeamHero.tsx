import { useId } from 'react';

import { GameImage } from '@/components/games/GameImage';
import { Avatar } from '@/components/ui/avatar';
import { StatStrip } from '@/components/ui/stat-strip';
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
   * The team's ladder line, or `undefined` when the team has no line yet — a line is created by
   * the FIRST match result, not by team creation.
   */
  standing: RankingEntry | undefined;
  ladderSize: number;
  rankingsPending: boolean;
  rankingsError: boolean;
  /**
   * Role-dependent buttons rendered in the identity row ("Create match" for the captain, "Leave
   * team" for a plain member, nothing for a visitor).
   */
  actions?: ReactNode;
};

// "Dossier" header: game artwork, team identity, then the stats strip. Elo, record and rank
// come from the LADDER RANKINGS, not from GET /teams/{id}.
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

        {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <StatStrip
        stats={[
          { label: 'Elo', value: standing ? String(standing.elo) : EM_DASH },
          {
            label: 'Record',
            value: standing ? formatRecord(standing.wins, standing.losses) : EM_DASH,
          },
          {
            label: 'Rank',
            value: standing ? `#${standing.rank}` : EM_DASH,
            extra: standing ? `/ ${ladderSize}` : undefined,
          },
          { label: 'Roster', value: String(memberCount), extra: `/ ${ROSTER_LIMIT}` },
        ]}
        note={
          // "No line yet" and "the request failed" must not look alike — hence the two flags.
          rankingsError
            ? 'Ladder standings could not be loaded.'
            : !rankingsPending && !standing
              ? // A PLAIN apostrophe (U+0027): the JSX this replaced wrote `&apos;`, which the JSX parser decodes to U+0027 — a curly ’ here would silently change the rendered text of a screen this ticket is not supposed to touch.
                "Not ranked yet — a ladder line is created by this team's first match result."
              : undefined
        }
      />
    </section>
  );
}
