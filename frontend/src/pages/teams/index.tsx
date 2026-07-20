import { Crown, Users } from 'lucide-react';

import { useCallback, useEffect, useState } from 'react';

import { LadderSelect } from '@/components/home/LadderSelect';
import { TeamCreation } from '@/components/home/TeamCreation';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

import { Link } from '@tanstack/react-router';

import type { components } from '@/lib/api-types.gen';

type TeamListItem = components['schemas']['TeamListItem'];
type TeamMember = components['schemas']['TeamMember'];

export function Teams() {
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [gameFilter, setGameFilter] = useState<string>();
  // GET /teams doesn't carry members, so we fetch each team's detail to get the
  // roster faces. Keyed by team id; a team missing here just renders no avatars.
  const [rosters, setRosters] = useState<Record<string, TeamMember[]>>({});
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);

  const loadTeams = useCallback(async () => {
    setFormOpen(false);
    try {
      const { teams } = await apiFetch<{ teams: TeamListItem[] }>('/teams');
      setTeams(teams);

      // Pull every roster in parallel. A team whose detail fails just resolves
      // to an empty roster so one bad fetch never blanks the whole page.
      const entries = await Promise.all(
        teams.map((team) =>
          apiFetch<{ members: TeamMember[] }>(`/teams/${team.id}`)
            .then(({ members }) => [team.id, members] as const)
            .catch(() => [team.id, []] as const),
        ),
      );
      setRosters(Object.fromEntries(entries));
    } catch {
      setError('Could not load your teams.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount; all setState runs after await, never synchronously
    void loadTeams();
  }, [loadTeams]);

  // '' (All) and undefined are both falsy → no game filter, show everything.
  const shown = gameFilter ? teams.filter((team) => team.gameId === gameFilter) : teams;

  return (
    <div className="panel flex flex-col gap-4 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Users className="size-4" /> Squads
        </p>
        <h1 className="text-3xl label-caps-black">My teams</h1>
      </header>

      {error && (
        <p className="text-sm text-arena-red" role="alert">
          {error}
        </p>
      )}

      {formOpen ? (
        <TeamCreation onCreated={loadTeams} />
      ) : (
        <>
          {/* Filter the list by game; "All" (default) shows every team. */}
          <LadderSelect mode="game" all excludeSolo value={gameFilter} onChange={setGameFilter} />

          {shown.length === 0 ? (
            <p className="rounded-control border border-dashed border-border-subtle px-4 py-10 text-center text-sm text-text-muted">
              You're not part of any team.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((team) => (
                <TeamCard key={team.id} team={team} members={rosters[team.id] ?? []} />
              ))}
            </ul>
          )}
        </>
      )}

      <Button
        variant={formOpen ? 'secondary' : 'primary'}
        aria-expanded={formOpen}
        onClick={() => {
          setFormOpen((open) => !open);
        }}
      >
        {formOpen ? 'Cancel' : 'Create new team'}
      </Button>
    </div>
  );
}

//// a row of single team

type TeamCardProps = {
  team: TeamListItem;
  members: TeamMember[];
};

function TeamCard({ team, members }: TeamCardProps) {
  return (
    <li>
      <Link
        className="flex items-center gap-4 rounded-control border border-border-subtle bg-surface-card-strong/40 p-4 transition hover:bg-surface-card-strong"
        to="/teams/$teamId"
        params={{ teamId: team.id }}
      >
        <Avatar
          src={team.logoUrl ?? undefined}
          alt={team.name}
          fallback={team.name.slice(0, 2).toUpperCase()}
          className="rounded-2xl ring-1"
        />

        {/* Name + ladder */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-lg font-black uppercase leading-none text-text-primary">
              {team.name}
            </span>
          </div>
          <span className="mt-1 block truncate text-xs text-text-muted">{team.ladder}</span>
        </div>

        <span className="hidden rounded-full border border-border-subtle px-3 py-1 text-xs label-caps text-text-secondary sm:inline">
          {team.isCaptain && (
            <Crown className="size-4 shrink-0 text-rank-gold" aria-label="You are the captain" />
          )}
        </span>

        {/* Stacked member faces */}
        <div className="flex -space-x-2">
          {members.map((member, i) => (
            <div key={member.id} className="relative" style={{ zIndex: members.length - i }}>
              <Avatar
                src={member.avatarUrl ?? undefined}
                alt={member.pseudo}
                fallback={member.pseudo.slice(0, 2).toUpperCase()}
                className="size-14"
              />
            </div>
          ))}
        </div>
      </Link>
    </li>
  );
}
