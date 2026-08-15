import { useRef, useState } from 'react';

import { useAnnouncement } from '@/lib/use-announcement';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RosterChips } from '@/components/teams/detail/RosterChips';
import { SectionTitle } from '@/components/ui/section-title';
import { TeamDangerZone } from '@/components/teams/detail/TeamDangerZone';
import { TeamIdentity } from '@/components/teams/detail/TeamIdentity';
import { TeamInvitePlayer } from '@/components/teams/detail/TeamInvitePlayer';
import {
  cancelTeamInvitationErrorMessage,
  removeTeamMemberErrorMessage,
  useCancelTeamInvitation,
  useRemoveTeamMember,
} from '@/lib/team-mutations';

import type { TeamDetail, TeamInvitation, TeamMember } from '@/lib/team-detail';

type TeamManageProps = {
  team: TeamDetail;
  members: TeamMember[];
  /** Pending invitations of this team — `[]` unless the caller is a member. */
  invitations: TeamInvitation[];
};

/** Captain-only tab: rename, logo, roster and dissolution. */
export function TeamManage({ team, members, invitations }: TeamManageProps) {
  // The member the captain is about to remove — `null` closes the dialog. Holding the whole
  // member (not just an id) is what lets the confirmation NAME the player.
  const [memberToKick, setMemberToKick] = useState<TeamMember | null>(null);
  // Its own state and its own dialog below, NOT one generic dialog multiplexing both:
  // cancelling an invitation and kicking a member differ in tone, wording and consequence, and
  // a shared instance would have to re-derive which one it is showing on every render.
  const [invitationToCancel, setInvitationToCancel] = useState<TeamInvitation | null>(null);
  // Ce qui vient de quitter le roster. Les DEUX actions alimentent le même message : elles
  // vident la même liste, et deux régions se disputeraient la lecture.
  const roster = useAnnouncement();
  // Landing point when a confirmed removal destroys the chip that opened the dialog.
  // The Roster heading is the closest thing GUARANTEED to survive it.
  const rosterHeadingRef = useRef<HTMLHeadingElement>(null);
  const kick = useRemoveTeamMember(team.id);
  const cancelInvitation = useCancelTeamInvitation(team.id);

  function confirmKick() {
    if (!memberToKick) return;
    // `mutate`, not `mutateAsync`: a rejection is captured in `kick.error` and shown in the
    // dialog, so there is no promise left dangling in the handler.
    kick.mutate(memberToKick.id, {
      onSuccess: () => {
        roster.announce(`@${memberToKick.pseudo} was removed from the roster.`);
        setMemberToKick(null);
      },
    });
  }

  function cancelKick() {
    kick.reset();
    setMemberToKick(null);
  }

  function confirmCancelInvitation() {
    if (!invitationToCancel) return;
    cancelInvitation.mutate(invitationToCancel.id, {
      onSuccess: () => {
        roster.announce(`The invitation to @${invitationToCancel.user.pseudo} was cancelled.`);
        setInvitationToCancel(null);
      },
    });
  }

  function dismissCancelInvitation() {
    cancelInvitation.reset();
    setInvitationToCancel(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <TeamIdentity team={team} />

      <TeamInvitePlayer teamId={team.id} members={members} invitations={invitations} />

      <section className="flex flex-col gap-3.5">
        <SectionTitle headingRef={rosterHeadingRef}>Roster</SectionTitle>

        <p role="status" className="sr-only">
          {roster.message}
        </p>
        <RosterChips
          members={members}
          provider={team.requiredProvider}
          showAccountState
          onKick={setMemberToKick}
          invitations={invitations}
          onCancelInvitation={setInvitationToCancel}
        />
      </section>

      <TeamDangerZone teamId={team.id} teamName={team.name} />

      <ConfirmDialog
        open={memberToKick !== null}
        title="Remove this player?"
        description={
          <>
            <strong className="text-text-primary">@{memberToKick?.pseudo}</strong> will lose
            access to this team. You can invite them back later.
          </>
        }
        confirmLabel="Remove player"
        pending={kick.isPending}
        error={kick.isError ? removeTeamMemberErrorMessage(kick.error, 'kick') : null}
        onConfirm={confirmKick}
        onCancel={cancelKick}
        returnFocusRef={rosterHeadingRef}
      />

      <ConfirmDialog
        open={invitationToCancel !== null}
        title="Cancel this invitation?"
        description={
          <>
            <strong className="text-text-primary">@{invitationToCancel?.user.pseudo}</strong>{' '}
            will no longer be able to join this team, and the roster slot is freed. You can
            invite them again later.
          </>
        }
        confirmLabel="Cancel invitation"
        cancelLabel="Keep it"
        tone="primary"
        pending={cancelInvitation.isPending}
        error={
          cancelInvitation.isError
            ? cancelTeamInvitationErrorMessage(cancelInvitation.error)
            : null
        }
        onConfirm={confirmCancelInvitation}
        onCancel={dismissCancelInvitation}
        returnFocusRef={rosterHeadingRef}
      />
    </div>
  );
}
