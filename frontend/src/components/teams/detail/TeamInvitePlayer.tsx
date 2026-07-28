import { useState } from 'react';

import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { SectionTitle } from '@/components/ui/section-title';
import { UserSearch } from '@/components/search/UserSearch';
import { ROSTER_LIMIT, rosterUsage } from '@/lib/team-detail';
import { inviteTeamMemberErrorMessage, useInviteTeamMember } from '@/lib/team-mutations';

import type { UserSearchResult } from '@/components/search/UserSearch';
import type { TeamInvitation, TeamMember } from '@/lib/team-detail';

type TeamInvitePlayerProps = {
  teamId: string;
  members: TeamMember[];
  invitations: TeamInvitation[];
};

/**
 * Captain's recruiting block. Since B-INV it INVITES — the player is not added, they get a
 * pending invitation and decide for themselves. Every word here has to say so, or the
 * captain will believe the roster changed when it did not.
 */
export function TeamInvitePlayer({ teamId, members, invitations }: TeamInvitePlayerProps) {
  const invite = useInviteTeamMember(teamId);
  const [invitedPseudo, setInvitedPseudo] = useState<string | null>(null);
  // Bumped on every successful invitation and used as UserSearch's `key`: remounting is the
  // idiomatic way to reset a child's internal state (the typed query and its results)
  // without reaching into it. Two things come for free — the field is empty and ready for
  // the next player, and the unmount cleanup drops a debounce still waiting to fire, so
  // no search leaves for a panel nobody will look at.
  const [invitedCount, setInvitedCount] = useState(0);

  // ⚠️ `used` counts members AND pending invitations, because that is what the server's
  // cap counts. A counter on members alone would read "3/10" right up to the 409.
  const { used, pending, full } = rosterUsage(members, invitations);
  // /search knows nothing about this team: without this the captain would see, and be able
  // to click, players already on the roster (409 `already_member`) or already invited
  // (409 `already_invited`).
  const excludeIds = [
    ...members.map((member) => member.id),
    ...invitations.map((invitation) => invitation.user.id),
  ];

  function handleSelect(found: UserSearchResult) {
    // Deux clics rapides sur la même ligne partiraient tous les deux : `excludeIds` ne se
    // met à jour qu'APRÈS le refetch, donc la ligne reste cliquable entre-temps. Le second
    // POST reviendrait en 409 « already_invited » — un message d'échec affiché alors que
    // l'invitation a réussi, ET une ligne rouge dans la console. `UserSearch` reçoit aussi
    // `disabled` plus bas : cette garde couvre la course, le `disabled` la rend visible.
    if (invite.isPending) return;

    setInvitedPseudo(null);
    invite.mutate(found.id, {
      onSuccess: () => {
        setInvitedPseudo(found.pseudo);
        setInvitedCount((count) => count + 1);
      },
    });
  }

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Invite a player</SectionTitle>

      {/* "Roster SLOTS", not "Roster": the header stat of the same page reads a SMALLER
          number on purpose — it counts members, and it is public, so it cannot include
          invitations a visitor is not allowed to know about. Two labels, two honest
          numbers; one shared label would have read as a bug. */}
      <p className="text-xs text-text-muted">
        Roster slots {used}/{ROSTER_LIMIT}
        {pending > 0 ? ` · ${pending} pending` : ''} — a pending invitation holds a slot, and
        a player can only belong to one team per ladder.
      </p>

      {full ? (
        // The 409 `roster_full` stays the real rampart; this only avoids sending a request
        // whose answer is already known.
        <Callout tone="muted">
          This roster is full. Cancel a pending invitation or remove a player before inviting
          someone else.
        </Callout>
      ) : (
        <>
          <UserSearch
            key={invitedCount}
            onSelect={handleSelect}
            placeholder="Search a player by pseudo…"
            excludeIds={excludeIds}
            disabled={invite.isPending}
          />

          {invite.isPending ? (
            <p role="status" className="text-xs text-text-muted">
              Sending the invitation…
            </p>
          ) : null}

          {invite.isError ? (
            <FormMessage>{inviteTeamMemberErrorMessage(invite.error)}</FormMessage>
          ) : null}

          {invitedPseudo && !invite.isPending && !invite.isError ? (
            // NOT "joined the roster": nothing joined anything. The chip below says
            // "Pending" for exactly as long as this is true.
            <p role="status" className="text-xs text-success">
              @{invitedPseudo} has been invited.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
