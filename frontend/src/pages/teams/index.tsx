import { Users } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { LadderSelect } from '@/components/home/LadderSelect';
import { TeamCreation } from '@/components/home/TeamCreation';
import { TeamInvitations } from '@/components/teams/TeamInvitations';
import { TeamsCards } from '@/components/teams/TeamsCards';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MY_INVITATIONS_KEY, useMyTeams } from '@/lib/teams';

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
  // Non-blocking warning from TeamCreation (e.g. the logo upload failed even
  // though the team was created) — TeamCreation unmounts the moment it calls
  // onCreated, so this banner is the only place it can still be shown.
  const [createdTeamWarning, setCreatedTeamWarning] = useState<string>();
  // The games the user has at least one team in. Empty while the query loads
  // and for a user with no team: only "All" shows, which is the point.
  const myGameIds = [...new Set(data?.teams.map((team) => team.gameId) ?? [])];

  function openForm() {
    setCreatedTeamName(undefined);
    setCreatedTeamWarning(undefined);
    setFormOpen(true);
  }

  async function handleCreated(teamName: string, warning?: string) {
    setFormOpen(false);
    setCreatedTeamName(teamName);
    setCreatedTeamWarning(warning);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['teams'] }),
      // ⚠️ Creating a team CANCELS, server-side and in the same transaction, the pending
      // invitations I had received on that ladder — I have a team there now, they could
      // only ever end in a 409. Without this refetch they would stay on screen, and their
      // Accept button would fire a request whose answer is already known.
      queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY }),
    ]);
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
        <div className="flex flex-col gap-2">
          <Callout tone="success" role="status">
            “{createdTeamName}” was created.
          </Callout>
          {createdTeamWarning && (
            <Callout tone="muted" role="status">
              {createdTeamWarning}
            </Callout>
          )}
        </div>
      )}

      {formOpen ? (
        <TeamCreation onCreated={handleCreated} onCancel={() => setFormOpen(false)} />
      ) : (
        <>
          {/* Above the grid, and self-contained: it renders nothing at all when there is
              no invitation to answer. Hidden while the creation form is open — one task
              at a time. */}
          <TeamInvitations />

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
