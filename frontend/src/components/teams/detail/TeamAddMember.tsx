import { useState } from 'react';

import { FormMessage } from '@/components/ui/form-message';
import { SectionTitle } from '@/components/ui/section-title';
import { UserSearch } from '@/components/search/UserSearch';
import { ROSTER_LIMIT } from '@/lib/team-detail';
import { addTeamMemberErrorMessage, useAddTeamMember } from '@/lib/team-mutations';

import type { UserSearchResult } from '@/components/search/UserSearch';
import type { TeamMember } from '@/lib/team-detail';

type TeamAddMemberProps = {
  teamId: string;
  members: TeamMember[];
};

export function TeamAddMember({ teamId, members }: TeamAddMemberProps) {
  const addMember = useAddTeamMember(teamId);
  const [addedPseudo, setAddedPseudo] = useState<string | null>(null);
  // Bumped on every successful add and used as UserSearch's `key`: remounting is the
  // idiomatic way to reset a child's internal state (the typed query and its results)
  // without reaching into it. Two things come for free — the field is empty and ready for
  // the next player, and the unmount cleanup drops a debounce still waiting to fire, so
  // no search leaves for a panel nobody will look at.
  const [addedCount, setAddedCount] = useState(0);

  const full = members.length >= ROSTER_LIMIT;
  // /search knows nothing about this team: without this the captain would see, and be
  // able to click, players who are already on the roster — an instant 409.
  const excludeIds = members.map((member) => member.id);

  function handleSelect(found: UserSearchResult) {
    // Deux clics rapides sur la même ligne partiraient tous les deux : `excludeIds` ne se
    // met à jour qu'APRÈS le refetch, donc la ligne reste cliquable entre-temps. Le second
    // POST reviendrait en 409 « already a member » — un message d'échec affiché alors que
    // l'ajout a réussi, ET une ligne rouge dans la console. `UserSearch` reçoit aussi
    // `disabled` plus bas : cette garde couvre la course, le `disabled` la rend visible.
    if (addMember.isPending) return;

    setAddedPseudo(null);
    addMember.mutate(found.id, {
      onSuccess: () => {
        setAddedPseudo(found.pseudo);
        setAddedCount((count) => count + 1);
      },
    });
  }

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Add a player</SectionTitle>

      <p className="text-xs text-text-muted">
        Roster {members.length}/{ROSTER_LIMIT} · a player can only belong to one team per
        ladder.
      </p>

      {full ? (
        // The 409 "team is full" stays the real rampart; this only avoids sending a
        // request whose answer is already known.
        <p className="rounded-control border border-border-subtle bg-surface-card-strong/60 px-4 py-3 text-sm text-text-secondary">
          This roster is full. Remove a player before adding another one.
        </p>
      ) : (
        <>
          <UserSearch
            key={addedCount}
            onSelect={handleSelect}
            placeholder="Search a player by pseudo…"
            excludeIds={excludeIds}
            disabled={addMember.isPending}
          />

          {addMember.isPending ? (
            <p role="status" className="text-xs text-text-muted">
              Adding the player…
            </p>
          ) : null}

          {addMember.isError ? (
            <FormMessage>{addTeamMemberErrorMessage(addMember.error)}</FormMessage>
          ) : null}

          {addedPseudo && !addMember.isPending && !addMember.isError ? (
            <p role="status" className="text-xs text-success">
              @{addedPseudo} joined the roster.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
