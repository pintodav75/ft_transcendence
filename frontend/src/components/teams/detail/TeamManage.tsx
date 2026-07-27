import { useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RosterChips } from '@/components/teams/detail/RosterChips';
import { SectionTitle } from '@/components/ui/section-title';
import { TeamAddMember } from '@/components/teams/detail/TeamAddMember';
import { TeamDangerZone } from '@/components/teams/detail/TeamDangerZone';
import { TeamIdentity } from '@/components/teams/detail/TeamIdentity';
import { removeTeamMemberErrorMessage, useRemoveTeamMember } from '@/lib/team-mutations';

import type { TeamDetail, TeamMember } from '@/lib/team-detail';

type TeamManageProps = {
  team: TeamDetail;
  members: TeamMember[];
};

/**
 * Captain-only tab: rename, logo, roster and dissolution.
 *
 * The page decides WHO sees this (`team.captainId === me`); nothing here re-derives the
 * role. The backend refuses every one of these calls to a non-captain anyway — this tab
 * is the readable half of that rule, not the enforcement.
 */
export function TeamManage({ team, members }: TeamManageProps) {
  // The member the captain is about to remove — `null` closes the dialog. Holding the
  // whole member (not just an id) is what lets the confirmation NAME the player.
  const [memberToKick, setMemberToKick] = useState<TeamMember | null>(null);
  const kick = useRemoveTeamMember(team.id);

  function confirmKick() {
    if (!memberToKick) return;
    // `mutate`, not `mutateAsync`: a rejection is captured in `kick.error` and shown in
    // the dialog, so there is no promise left dangling in the handler.
    kick.mutate(memberToKick.id, { onSuccess: () => setMemberToKick(null) });
  }

  function cancelKick() {
    kick.reset();
    setMemberToKick(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <TeamIdentity team={team} />

      <TeamAddMember teamId={team.id} members={members} />

      <section className="flex flex-col gap-3.5">
        <SectionTitle>Roster</SectionTitle>
        <RosterChips
          members={members}
          provider={team.requiredProvider}
          showAccountState
          onKick={setMemberToKick}
        />
      </section>

      <TeamDangerZone teamId={team.id} teamName={team.name} />

      {/* One instance, kept mounted for the whole tab: `open` is the only thing that
          moves. It lives inside the Manage panel, which is the only place a Kick button
          can be clicked, so it is never asked to open while its panel is `hidden`. */}
      <ConfirmDialog
        open={memberToKick !== null}
        title="Remove this player?"
        description={
          <>
            <strong className="text-text-primary">@{memberToKick?.pseudo}</strong> will lose
            access to this team. You can add them back later.
          </>
        }
        confirmLabel="Remove player"
        pending={kick.isPending}
        error={kick.isError ? removeTeamMemberErrorMessage(kick.error) : null}
        onConfirm={confirmKick}
        onCancel={cancelKick}
      />
    </div>
  );
}
