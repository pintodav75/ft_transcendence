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
   * Ce que la page hôte prête à ce bloc pour le seul cas où il DISPARAÎT ENTIÈREMENT :
   * refuser la dernière invitation démonte la section, et avec elle son titre (le point
   * d'atterrissage habituel du focus) ET sa région live (donc l'annonce, qui s'effacerait
   * avant d'être lue). Les deux ont la même cause, ils viennent donc ensemble.
   *
   * Optionnel : sans lui le composant fonctionne exactement comme avant, et sa promesse
   * d'origine — déposable tel quel sur `/profile` ou dans le rail social — est intacte.
   */
  host?: {
    focusRef: RefObject<HTMLElement | null>;
    announce: (message: string) => void;
  };
};

/**
 * The teams that have invited me, with Accept / Decline.
 *
 * SELF-CONTAINED on purpose: it takes no props and runs its own query, so it can be dropped
 * on `/profile` or into the social rail later without a line of rewriting. That is the only
 * concession made to a future consumer — no "generic" API was invented for one that does
 * not exist yet.
 *
 * ⚠️ Renders NOTHING when there is no invitation. An "you have no invitation" block would be
 * permanent noise on every visit for a case that is rare by nature.
 */
export function TeamInvitations({ host }: TeamInvitationsProps = {}) {
  const { data, isError } = useMyTeamInvitations();
  const accept = useAcceptTeamInvitation();
  const decline = useDeclineTeamInvitation();
  // Survives the list going empty: accepting my last invitation removes the row that
  // triggered it, so the confirmation has to live outside the list to still be readable.
  const [joinedTeamName, setJoinedTeamName] = useState<string | null>(null);
  // FX-FOCUS — répondre supprime la ligne AVEC ses deux boutons. Il n'y a même pas de
  // `<dialog>` ici pour tenter une restauration : sans point d'atterrissage, le focus tombe
  // sur `<body>` et l'utilisateur au clavier repart du haut de la page.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answered = useAnnouncement();

  const invitations = data?.invitations ?? [];

  if (isError) {
    return <FormMessage className="text-sm">Could not load your team invitations.</FormMessage>;
  }

  // Loading renders nothing either: a skeleton would push the grid down on every single
  // visit for a block that is usually absent.
  if (invitations.length === 0 && !joinedTeamName) return null;

  /**
   * ⚠️ BOTH mutations are reset at the start of BOTH handlers, and the success banner with
   * them. With several invitations on screen the two mutation objects are shared by every
   * row, so without this: the "You joined A" banner would still sit above a row I am now
   * DECLINING, and a failed accept would keep printing its error on the row while the
   * decline that replaced it is still in flight (the `accept ?? decline` chain below reads
   * `accept` first). Same pattern as `dismissCancelInvitation` in `TeamManage`.
   */
  function clearFeedback() {
    accept.reset();
    decline.reset();
    setJoinedTeamName(null);
  }

  function handleAccept(invitation: MyTeamInvitation) {
    clearFeedback();
    // No navigation on success. The grid below refreshes on its own (`['teams']` is
    // invalidated by the hook) and the new team appears — which is the proof asked for,
    // without replaying the navigate/removeQueries minefield of the dissolution flow.
    accept.mutate(invitation.id, {
      onSuccess: () => {
        // Le focus est déplacé AVANT le rendu qui démonte la ligne : il est alors déjà
        // ailleurs, donc la disparition ne l'emporte pas.
        headingRef.current?.focus();
        answered.announce(`You joined ${invitation.team.name}.`);
        setJoinedTeamName(invitation.team.name);
      },
    });
  }

  function handleDecline(invitation: MyTeamInvitation) {
    clearFeedback();
    decline.mutate(invitation.id, {
      onSuccess: () => {
        // ⚠️ Refuser la DERNIÈRE invitation démonte tout le bloc, titre compris (le garde
        // `invitations.length === 0 && !joinedTeamName` juste au-dessus). Accepter, lui, le
        // garde en vie pour afficher « You joined … ». D'où le repli fourni par la page.
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

      {/* Montée en permanence, seul son texte change : une région insérée en même temps que
          son contenu n'est pas annoncée de façon fiable. */}
      <p role="status" className="sr-only">
        {answered.message}
      </p>

      {/* Plus de `role="status"` sur ce Callout : l'annonce passe par la région ci-dessus,
          une seule voix pour un seul événement. Ce bloc redevient purement visuel. */}
      {joinedTeamName && <Callout tone="success">You joined “{joinedTeamName}”.</Callout>}

      {/* role="list" is explicit: Tailwind's preflight drops the marker, and Safari then
          drops list semantics from the accessibility tree with it. */}
      <ul role="list" className="flex flex-col gap-2">
        {invitations.map((invitation) => {
          // ⚠️ PER ROW. One `useMutation` is shared by the whole list, so
          // `accept.isPending` alone would spin every row at once; pairing it with
          // `variables` narrows it to the invitation actually being answered.
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

              {/* `min-w-32` is what makes the two buttons drop onto their own line on a
                  narrow screen instead of crushing the team name to three letters. */}
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
                {/* Nominative accessible names: three rows of "Accept" tell a screen
                    reader user nothing about WHICH team they are joining. */}
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
