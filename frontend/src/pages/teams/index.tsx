import { Users } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useAnnouncement } from '@/lib/use-announcement';
import { useQueryClient } from '@tanstack/react-query';

import { LadderSelect } from '@/components/home/LadderSelect';
import { TeamCreation } from '@/components/home/TeamCreation';
import { TeamInvitations } from '@/components/teams/TeamInvitations';
import { TeamsCards } from '@/components/teams/TeamsCards';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MY_INVITATIONS_KEY, useMyTeams } from '@/lib/teams';
import { useLadders } from '@/lib/games';

export function Teams() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // `?create=<ladderId>`, set by the "Create a team" button of a game page.
  const { create: requestedLadderId } = useSearch({ from: '/_authenticated/teams/' });
  // Same cached `GET /ladders` the picker below reads: validating the param costs no request.
  const laddersQuery = useLadders();
  // Same ['teams'] query as the grid below, so this is the cache, not a second request — it
  // only serves to keep the filter bar honest (see myGameIds).
  const { data } = useMyTeams();
  // Repli quand refuser la dernière invitation démonte le bloc entier : ni son titre
  // ni sa région live ne survivent, la page prête donc les siens.
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageAnnouncement = useAnnouncement();
  const [gameFilter, setGameFilter] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  // Names the team just created for the success banner above the grid; a stale name must not
  // survive reopening the form for a second team.
  const [createdTeamName, setCreatedTeamName] = useState<string>();
  // Non-blocking warning from TeamCreation (e.g.
  const [createdTeamWarning, setCreatedTeamWarning] = useState<string>();
  // The games the user has at least one team in. Empty while the query loads and for a user
  // with no team: only "All" shows, which is the point.
  const myGameIds = [...new Set(data?.teams.map((team) => team.gameId) ?? [])];

  /**
   * The ladder named by `?create=`, or `undefined` — which is what an unknown id, a solo ladder
   * or a still-loading list all mean here.
   */
  const requestedLadder = requestedLadderId
    ? laddersQuery.data?.ladders.find(
        (ladder) => ladder.id === requestedLadderId && ladder.format !== '1v1',
      )
    : undefined;

  // Derived, not stored: the param arrives before the ladder list resolves, and copying it into
  // state through an effect would render one frame of the wrong screen first.
  const showForm = formOpen || Boolean(requestedLadder);

  // The param has to go when the form does, otherwise the next render would reopen it.
  // `replace` so the closed form does not become a history entry of its own.
  function dropCreateParam() {
    if (!requestedLadderId) return;
    void navigate({ to: '/teams', search: {}, replace: true });
  }

  function openForm() {
    setCreatedTeamName(undefined);
    setCreatedTeamWarning(undefined);
    // La bannière qu'on vient d'effacer décrivait un état révolu : la région live doit suivre,
    // sinon elle contredit l'écran.
    pageAnnouncement.reset();
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    dropCreateParam();
  }

  async function handleCreated(teamName: string, warning?: string) {
    setFormOpen(false);
    dropCreateParam();
    // L'annonce passe par LA région de la page (les Callout ne sont plus que visuels) : un seul
    // événement, une seule voix.
    pageAnnouncement.announce(
      warning ? `“${teamName}” was created. ${warning}` : `“${teamName}” was created.`,
    );
    setCreatedTeamName(teamName);
    setCreatedTeamWarning(warning);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['teams'] }),
      // Creating a team CANCELS, server-side and in the same transaction, the pending
      // invitations I had received on that ladder — I have a team there now, they could only
      // ever end in a 409.
      queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_KEY }),
    ]);
  }

  return (
    <div className="panel flex flex-col gap-4 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Users aria-hidden="true" className="size-4" /> Squads
        </p>
        <h1 ref={pageHeadingRef} tabIndex={-1} className="focus-ring rounded-control text-3xl label-caps-black">
          My teams
        </h1>

        <p role="status" className="sr-only">
          {pageAnnouncement.message}
        </p>
      </header>

      {createdTeamName && (
        <div className="flex flex-col gap-2">
          <Callout tone="success">“{createdTeamName}” was created.</Callout>
          {createdTeamWarning && (
            <Callout tone="muted">{createdTeamWarning}</Callout>
          )}
        </div>
      )}

      {showForm ? (
        <TeamCreation
          // Pre-picked when we got here from a game page; `undefined` keeps the picker's own
          // default (first game, first format), i.e. the behaviour without the param.
          defaultLadderId={requestedLadder?.id}
          onCreated={handleCreated}
          onCancel={closeForm}
        />
      ) : (
        <>

          <TeamInvitations host={{ focusRef: pageHeadingRef, announce: pageAnnouncement.announce }} />

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

      {!showForm && (
        <Button variant="primary" aria-expanded={showForm} onClick={openForm}>
          Create new team
        </Button>
      )}
    </div>
  );
}
