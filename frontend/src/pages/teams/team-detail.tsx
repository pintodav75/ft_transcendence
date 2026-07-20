// this is the page to view a single team
// the Search to add user to the team feature is not yet installed
// same for the upload avatar for the team

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Crown } from 'lucide-react';
import type { components } from '@/lib/api-types.gen';
import { apiFetch, ApiError } from '@/lib/api';
type TeamDetail = components['schemas']['TeamDetail'];
type TeamMember = components['schemas']['TeamMember'];
import { useAuthStore } from '@/stores/auth-store';

import { Avatar } from '@/components/ui/avatar';
import SearchBar from '@/components/home/SearchBar';
import { Button } from '@/components/ui/button';

const ViewerRole = {
  Guest: 0,
  Stranger: 1,
  Member: 2,
  Captain: 3,
} as const;

type ViewerRole = (typeof ViewerRole)[keyof typeof ViewerRole];

function getViewerRole(team: TeamDetail, members: TeamMember[], userId: string): ViewerRole {
  if (!userId) return ViewerRole.Guest;
  if (team.captainId === userId) return ViewerRole.Captain;
  if (members.some((m) => m.id === userId)) return ViewerRole.Member;
  return ViewerRole.Stranger;
}

export function TeamDetail() {
  const { teamId } = useParams({ from: '/teams/$teamId' });
  const navigate = useNavigate();

  const [team, setTeam] = useState<TeamDetail>();
  const [members, setMembers] = useState<TeamMember[]>();
  const [error, setError] = useState<string>();

  // logged out / not part of the team / part of the team / captain

  useEffect(() => {
    apiFetch<{ team: TeamDetail; members: TeamMember[] }>('/teams/' + teamId)
      .then((res) => {
        setTeam(res.team);
        setMembers(res.members);
      })
      .catch((err) => {
        console.log(err instanceof Error ? err.message : 'Could not load team');
        navigate({ to: '/teams' }); // load failed → bounce back to the teams list
      })
      .finally();
  }, [teamId, navigate]);

  const userId = useAuthStore((state) => state.user?.id);
  const priviledges =
    team && members && userId ? getViewerRole(team, members, userId) : ViewerRole.Guest;

  async function leaveTeam(user: string | undefined) {
    if (!team || !members || !user) return;
    if (members.every((m) => m.id !== user)) return; // not a member

    const isCaptain = user === team.captainId;
    if (
      isCaptain &&
      !window.confirm(`Delete "${team.name}"? This dissolves the team for everyone.`)
    ) {
      return;
    }
    setError(undefined);
    try {
      if (isCaptain) {
        await apiFetch<{ ok: true }>(`/teams/${team.id}`, { method: 'DELETE' });
        navigate({ to: '/teams' });
      } else {
        await apiFetch<{ ok: true }>(`/teams/${team.id}/members/${user}`, {
          method: 'DELETE',
        });
        if (user === userId) {
          navigate({ to: '/teams' }); // I left → back to my teams
        } else {
          setMembers((prev) => prev?.filter((m) => m.id !== user)); // I kicked someone → keep the page, drop them
        }
      }
    } catch {
      setError('Could not leave the team.');
    }
  }

  async function addMember(newUserId: string) {
    if (!team) return;
    setError(undefined);
    try {
      await apiFetch<{ ok: true }>(`/teams/${team.id}/members`, {
        method: 'POST',
        body: { userId: newUserId },
      });
      // Refresh the roster so the new member shows up and drops out of the search.
      const res = await apiFetch<{ team: TeamDetail; members: TeamMember[] }>('/teams/' + teamId);
      setTeam(res.team);
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add member.');
    }
  }

  if (!team || !members) {
    return <p>Loading…</p>;
  }

  return (
    <div className="panel">
      <div className="max-w-300 mx-auto p-10">
        {error && <p className="text-arena-red">{error}</p>}
        {priviledges >= ViewerRole.Member && (
          <Button
            variant="secondary"
            className="mb-10 flex gap-2 p-3"
            onClick={() => {
              navigate({ to: '/teams' });
            }}
          >
            <ArrowLeft /> Your teams
          </Button>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Avatar
              className="size-26 ring-2 mr-5"
              fallback="team"
              src={team?.logoUrl ?? undefined}
            ></Avatar>
            <div className="m-2 ">
              <div className="flex gap-2">
                <h2 className="text-2xl label-caps-black">{team.name}</h2>
                {userId === team.captainId && (
                  <Crown
                    className="size-5.5 shrink-0 text-rank-gold"
                    aria-label="You are the captain"
                  />
                )}
              </div>
              <p>
                {team.gameId.toUpperCase()} {team.format}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {priviledges >= ViewerRole.Member && (
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  alert('backrend route not yet setup');
                }}
              >
                Upload Avatar
              </Button>
            )}
            {priviledges >= ViewerRole.Captain && (
              <Button
                variant="danger"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  leaveTeam(userId);
                }}
              >
                Delete team
              </Button>
            )}
          </div>
        </div>

        <div className="m-5">
          <hr className="text-action-primary" />
          <h2 className="text-2xl label-caps m-5">Team members</h2>

          <div className="flex">
            {members.map((member) => (
              <div key={member.id} className="panel flex flex-col items-center w-50 h-50 m-2 p-2">
                <Avatar src={member.avatarUrl} className="m-2 size-18" />
                <div className="flex label-caps">
                  <p>{member.displayName ?? member.pseudo}</p>
                  {member.id === team.captainId && (
                    <Crown
                      className="size-4 shrink-0 text-rank-gold"
                      aria-label="You are the captain"
                    />
                  )}
                </div>
                <p className="text-text-muted">@{member.pseudo}</p>

                {priviledges >= ViewerRole.Captain && member.id !== userId && (
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs text-arena-red mt-2"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Kick "${member.displayName ?? member.pseudo}" out of "${team.name}"?`,
                        )
                      )
                        leaveTeam(member.id);
                    }}
                  >
                    Kick
                  </Button>
                )}
                {member.id === userId && priviledges !== ViewerRole.Captain && (
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs text-arena-red mt-2"
                    onClick={() => {
                      if (window.confirm(`Are you sure to leave "${team.name}"?`))
                        leaveTeam(member.id);
                    }}
                  >
                    Leave team
                  </Button>
                )}
              </div>
            ))}
          </div>

          {priviledges >= ViewerRole.Captain && (
            <>
              <hr className="text-action-primary m-5" />
              <h2 className="text-2xl label-caps m-5">Add member</h2>
              <SearchBar
                onSelect={(user) => addMember(user.id)}
                excludeIds={members.map((m) => m.id)} // remove players already in our team
                placeholder="Enter a player's pseudo"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TeamDetail;
