import { useRef, useState } from 'react';

import { useAnnouncement } from '@/lib/use-announcement';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { SectionTitle } from '@/components/ui/section-title';
import { useMyTeamInvitations } from '@/lib/teams';
import {
  respondToInvitationErrorMessage,
  useAcceptTeamInvitation,
  useDeclineTeamInvitation,
} from '@/lib/team-mutations';

import type { RefObject } from 'react';
import type { MyTeamInvitation } from '@/lib/teams';

type TeamInvitationsProps = {
  /**
   * Ce que la page hôte prête à ce bloc pour le seul cas où il DISPARAÎT ENTIÈREMENT : refuser
   * la dernière invitation démonte la section, et avec elle son titre (le point d'atterrissage
   * habituel du focus) ET sa région live (donc l'annonce, qui s'effacerait avant d'être lue).
   */
  host?: {
    focusRef: RefObject<HTMLElement | null>;
    announce: (message: string) => void;
  };
};

/** The teams that have invited me, with Accept / Decline. */
export function TeamInvitations({ host }: TeamInvitationsProps = {}) {
  const { data, isError } = useMyTeamInvitations();
  const accept = useAcceptTeamInvitation();
  const decline = useDeclineTeamInvitation();
  // Survives the list going empty: accepting my last invitation removes the row that triggered
  // it, so the confirmation has to live outside the list to still be readable.
  const [joinedTeamName, setJoinedTeamName] = useState<string | null>(null);
  // Répondre supprime la ligne AVEC ses deux boutons.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answered = useAnnouncement();

  const invitations = data?.invitations ?? [];

  if (isError) {
    return <FormMessage className="text-sm">Could not load your team invitations.</FormMessage>;
  }

  // Loading renders nothing either: a skeleton would push the grid down on every single visit
  // for a block that is usually absent.
  if (invitations.length === 0 && !joinedTeamName) return null;

  /** BOTH mutations are reset at the start of BOTH handlers, and the success banner with them. */
  function clearFeedback() {
    accept.reset();
    decline.reset();
    setJoinedTeamName(null);
  }

  function handleAccept(invitation: MyTeamInvitation) {
    clearFeedback();
    // No navigation on success.
    accept.mutate(invitation.id, {
      onSuccess: () => {
        answered.announce(`You joined ${invitation.team.name}.`);
        setJoinedTeamName(invitation.team.name);
        // À LA FRAME SUIVANTE, PAS TOUT DE SUITE — et le commentaire d'avant disait l'inverse.
        requestAnimationFrame(() => headingRef.current?.focus());
      },
    });
  }

  function handleDecline(invitation: MyTeamInvitation) {
    clearFeedback();
    decline.mutate(invitation.id, {
      onSuccess: () => {
        // Refuser la DERNIÈRE invitation démonte tout le bloc, titre compris (le garde
        // `invitations.length === 0 && !joinedTeamName` juste au-dessus).
        const message = `The invitation from ${invitation.team.name} was declined.`;
        const lastOne = invitations.length === 1;
        if (lastOne && host) {
          host.focusRef.current?.focus();
          host.announce(message);
          return;
        }
        headingRef.current?.focus();
        answered.announce(message);
      },
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle headingRef={headingRef}>Team invitations</SectionTitle>

      <p role="status" className="sr-only">
        {answered.message}
      </p>

      {joinedTeamName && <Callout tone="success">You joined “{joinedTeamName}”.</Callout>}

      <ul role="list" className="flex flex-col gap-2">
        {invitations.map((invitation) => {
          // PER ROW.
          const accepting = accept.isPending && accept.variables === invitation.id;
          const declining = decline.isPending && decline.variables === invitation.id;
          const busy = accepting || declining;
          const failed =
            (accept.isError && accept.variables === invitation.id && accept.error) ||
            (decline.isError && decline.variables === invitation.id && decline.error) ||
            null;

          return (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-border-subtle bg-surface-card px-4 py-3"
            >
              <Avatar
                src={invitation.team.logoUrl ?? undefined}
                alt=""
                fallback={invitation.team.name.slice(0, 2).toUpperCase()}
                className="size-11 shrink-0"
              />

              <div className="min-w-32 flex-1">
                <p className="truncate text-sm font-bold text-text-primary">
                  {invitation.team.name}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {invitation.team.ladderName} · {invitation.team.format} · invited by @
                  {invitation.invitedBy.pseudo}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">

                <Button
                  variant="primary"
                  disabled={busy}
                  aria-label={`Accept the invitation from ${invitation.team.name}`}
                  onClick={() => handleAccept(invitation)}
                >
                  {accepting ? 'Joining…' : 'Accept'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  aria-label={`Decline the invitation from ${invitation.team.name}`}
                  onClick={() => handleDecline(invitation)}
                >
                  {declining ? 'Declining…' : 'Decline'}
                </Button>
              </div>

              {failed && (
                <FormMessage className="basis-full">
                  {respondToInvitationErrorMessage(failed)}
                </FormMessage>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
