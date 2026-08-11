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
  // [F-GAMES] — `?create=<ladderId>`, set by the "Create a team" button of a game page.
  const { create: requestedLadderId } = useSearch({ from: '/_authenticated/teams/' });
  // Same cached `GET /ladders` the picker below reads: validating the param costs no request.
  const laddersQuery = useLadders();
  // Same ['teams'] query as the grid below, so this is the cache, not a second
  // request — it only serves to keep the filter bar honest (see myGameIds).
  const { data } = useMyTeams();
  // FX-FOCUS — repli quand refuser la dernière invitation démonte le bloc entier : ni son
  // titre ni sa région live ne survivent, la page prête donc les siens.
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageAnnouncement = useAnnouncement();
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

  /**
   * The ladder named by `?create=`, or `undefined` — which is what an unknown id, a solo
   * ladder or a still-loading list all mean here.
   *
   * ⚠️ AN UNKNOWN PARAM IS IGNORED IN SILENCE: it opens nothing and raises nothing. The
   * ladder must EXIST (nine of them, cached) and be a team one — `POST /teams` answers 400 on
   * a 1v1 ladder, so pre-selecting one would open a form that could only fail.
   */
  const requestedLadder = requestedLadderId
    ? laddersQuery.data?.ladders.find(
        (ladder) => ladder.id === requestedLadderId && ladder.format !== '1v1',
      )
    : undefined;

  // Derived, not stored: the param arrives before the ladder list resolves, and copying it
  // into state through an effect would render one frame of the wrong screen first.
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
    // La bannière qu'on vient d'effacer décrivait un état révolu : la région live doit
    // suivre, sinon elle contredit l'écran.
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
    // L'annonce passe par LA région de la page (les Callout ne sont plus que visuels) :
    // un seul événement, une seule voix.
    pageAnnouncement.announce(
      warning ? `“${teamName}” was created. ${warning}` : `“${teamName}” was created.`,
    );
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
          <Users aria-hidden="true" className="size-4" /> Squads
        </p>
        <h1 ref={pageHeadingRef} tabIndex={-1} className="focus-ring rounded-control text-3xl label-caps-black">
          My teams
        </h1>

        {/* ⚠️ LA région live de la page, montée pour toute sa vie — donc elle survit à la
            disparition du bloc d'invitations, ce qui est tout l'intérêt. Il ne doit y en
            avoir QU'UNE : deux régions se disputent la lecture, et un sélecteur
            `[role="status"]` (les scénarios d'audit en utilisent) prendrait la première
            venue. C'est pour ça que les Callout ci-dessous n'en portent plus. */}
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
          {/* Above the grid, and self-contained: it renders nothing at all when there is
              no invitation to answer. Hidden while the creation form is open — one task
              at a time. */}
          <TeamInvitations host={{ focusRef: pageHeadingRef, announce: pageAnnouncement.announce }} />

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

      {!showForm && (
        <Button variant="primary" aria-expanded={showForm} onClick={openForm}>
          Create new team
        </Button>
      )}
    </div>
  );
}
