import { Crown } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import {
  RowList,
  rowLinkClasses,
  rowNameClasses,
  rowTrailingClasses,
} from '@/components/ui/row-list';
import { SectionTitle } from '@/components/ui/section-title';

import type { PlayerTeam } from '@/lib/player-detail';

type PlayerTeamsProps = {
  /** Already sorted by name by the API — never re-sorted here. */
  teams: PlayerTeam[];
  /** Display name of the profile, for an empty state that names who it is talking about. */
  name: string;
};

/** The teams this player belongs to, each row opening its page. */
export function PlayerTeams({ teams, name }: PlayerTeamsProps) {
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Teams</SectionTitle>

      {teams.length === 0 ? (
        // `text-text-secondary` rather than muted — see the same note in `PlayerRankings`.
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-sm text-text-secondary">
          {name} is not in any team yet.
        </p>
      ) : (
        <RowList>
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                aria-label={
                  team.isCaptain
                    ? `${team.name}, captain, ${team.ladder}`
                    : `${team.name}, ${team.ladder}`
                }
                className={rowLinkClasses}
              >
                <Avatar
                  src={team.logoUrl ?? undefined}
                  alt=""
                  fallback={team.name.slice(0, 2).toUpperCase()}
                  className="size-8 shrink-0"
                />
                <span className="truncate">{team.name}</span>

                {team.isCaptain && (
                  <Crown aria-hidden="true" className="size-4 shrink-0 text-rank-gold" />
                )}

                <span className={` ${rowNameClasses} text-xs label-caps text-text-secondary`}>
                  <span className="truncate">{team.ladder}</span>
                </span>

                <span className={`${rowTrailingClasses} font-mono text-xs tabular-nums`}>
                  <span className="font-bold text-text-primary">
                    {team.elo ?? '-'}
                    <span className="ml-1 font-normal text-text-muted">Elo</span>
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
