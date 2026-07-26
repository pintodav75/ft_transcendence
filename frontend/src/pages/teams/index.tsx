import { Users } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { LadderSelect } from '@/components/home/LadderSelect';
import { TeamCreation } from '@/components/home/TeamCreation';
import { TeamsCards } from '@/components/teams/TeamsCards';
import { Button } from '@/components/ui/button';
import { useMyTeams } from '@/lib/teams';

export function Teams() {
  const queryClient = useQueryClient();
  // Same ['teams'] query as the grid below, so this is the cache, not a second
  // request — it only serves to keep the filter bar honest (see myGameIds).
  const { data } = useMyTeams();
  const [gameFilter, setGameFilter] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  // Names the team just created for the success banner above the grid; a
  // stale name must not survive reopening the form for a second team.
  const [createdTeamName, setCreatedTeamName] = useState<string>();
  // The games the user has at least one team in. Empty while the query loads
  // and for a user with no team: only "All" shows, which is the point.
  const myGameIds = [...new Set(data?.teams.map((team) => team.gameId) ?? [])];

  function openForm() {
    setCreatedTeamName(undefined);
    setFormOpen(true);
  }

  async function handleCreated(teamName: string) {
    setFormOpen(false);
    setCreatedTeamName(teamName);
    await queryClient.invalidateQueries({ queryKey: ['teams'] });
  }

  return (
    <div className="panel flex flex-col gap-4 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Users className="size-4" /> Squads
        </p>
        <h1 className="text-3xl label-caps-black">My teams</h1>
      </header>

      {createdTeamName && (
        <p
          role="status"
          className="rounded-control border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
        >
          “{createdTeamName}” was created.
        </p>
      )}

      {formOpen ? (
        <TeamCreation onCreated={handleCreated} onCancel={() => setFormOpen(false)} />
      ) : (
        <>
          {/* Filter the list by game; "All" (default) shows every team. Only
              the games the user actually fields a team in get a button — the
              others could only ever filter down to an empty grid. */}
          <LadderSelect
            mode="game"
            all
            excludeSolo
            gameIds={myGameIds}
            value={gameFilter}
            onChange={setGameFilter}
          />

          <TeamsCards gameFilter={gameFilter} />
        </>
      )}

      {!formOpen && (
        <Button variant="primary" aria-expanded={formOpen} onClick={openForm}>
          Create new team
        </Button>
      )}
    </div>
  );
}
