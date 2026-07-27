import { useId } from 'react';

import { GameImage } from '@/components/games/GameImage';
import { Avatar } from '@/components/ui/avatar';
import { EM_DASH, ROSTER_LIMIT, formatRecord, ladderSubtitle } from '@/lib/team-detail';

import type { ReactNode } from 'react';
import type { RankingEntry, TeamDetail } from '@/lib/team-detail';

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

type StatProps = {
  label: string;
  value: string;
  extra?: string;
};

function Stat({ label, value, extra }: StatProps) {
  return (
    <div className="min-w-28 border-r border-border-subtle px-6 py-3.5 last:border-r-0">
      <dt className="text-xs label-caps text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-text-primary">
        {value}
        {extra && <span className="ml-1 text-sm font-normal text-text-muted">{extra}</span>}
      </dd>
    </div>
  );
}

// "Dossier" header: game artwork, team identity, then the stats strip. Elo, record and
// rank come from the LADDER RANKINGS, not from GET /teams/{id}.
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

      <div className="flex flex-wrap items-center border-t border-border-subtle bg-surface-card">
        <dl className="flex flex-wrap">
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
        </dl>

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
      </div>
    </section>
  );
}
