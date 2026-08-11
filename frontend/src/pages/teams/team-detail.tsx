import { useId, useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus, LogOut } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ErrorPanel } from '@/components/ui/error-panel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateMatchPanel } from '@/components/teams/detail/CreateMatchPanel';
import { TeamHero } from '@/components/teams/detail/TeamHero';
import { TeamManage } from '@/components/teams/detail/TeamManage';
import { TeamMatches } from '@/components/teams/detail/TeamMatches';
import { TeamOverview } from '@/components/teams/detail/TeamOverview';
import { Tabs } from '@/components/ui/tabs';
import { panelId, tabId } from '@/components/ui/tab-ids';
import { backLinkClasses } from '@/lib/back-navigation';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';
import { useSortedGames } from '@/lib/games';
import { cancelMatchErrorMessage, useCancelMatch } from '@/lib/match-mutations';
import { removeTeamMemberErrorMessage, useRemoveTeamMember } from '@/lib/team-mutations';
import { findTeamStanding, useLadderRankings } from '@/lib/ladders';
import { formatMatchDate } from '@/lib/match-detail';
import { isValidTeamId, teamMatchesKey, useTeam, useTeamMatches } from '@/lib/team-detail';

import type { TabItem } from '@/components/ui/tabs';
import type { TeamMatch } from '@/lib/team-detail';

const BASE_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
];

// Appended for the captain only. `Tabs` needs no change for this: it renders whatever
// array it is handed.
const MANAGE_TAB: TabItem = { id: 'manage', label: 'Manage' };

function BackToTeams() {
  return (
    <Link to="/teams" className={backLinkClasses}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      My teams
    </Link>
  );
}

// Same panel on both dead ends of this page — the shared component lives in
// `components/ui/error-panel.tsx` since the ladder page needed the very same screen.
function TeamErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <ErrorPanel title={title} message={message}>
      <Link to="/teams" className={buttonClasses('secondary')}>
        <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
        Back to my teams
      </Link>
    </ErrorPanel>
  );
}

export function TeamDetail() {
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' });
  const uid = useId();
  const createPanelId = useId();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  // FT-2C — the slot opener is a DISCLOSURE, not a modal: this flag drives both the inline
  // panel and the `aria-expanded` of the button that toggles it.
  const [creatingMatch, setCreatingMatch] = useState(false);
  // ISO instant of the slot just opened, so the confirmation can name it. Null = nothing to
  // announce.
  const [openedSlotAt, setOpenedSlotAt] = useState<string | null>(null);
  // Holding the whole match (not just an id) is what lets the confirmation state its date.
  const [slotToCancel, setSlotToCancel] = useState<TeamMatch | null>(null);
  // Focus has to come BACK to the opener when the panel closes; the browser only does that
  // for itself with a native <dialog>.
  const createButtonRef = useRef<HTMLButtonElement>(null);
  // FX-FOCUS — point d'atterrissage après une annulation de créneau. Le bouton qui a
  // ouvert la boîte a disparu : la ligne perd son action, et le bloc « Next match » entier
  // s'en va. Même règle que pour le roster — « l'élément survivant le plus proche qui NOMME
  // la liste » : dans l'onglet Matches c'est la région « Match history » du tableau ; dans
  // Overview aucun titre ne survit (la section « Next match » disparaît en entier), on se
  // rabat donc sur le panneau, qui est nommé par son onglet.
  const overviewPanelRef = useRef<HTMLDivElement>(null);
  // `HTMLElement` depuis [FX-TABLE] : l'historique pose le focus sur sa région défilante à
  // partir de `sm`, et sur le `<ul>` de ses cartes en dessous — deux balises, un seul usage.
  const matchHistoryRef = useRef<HTMLElement>(null);
  // UNE région live pour la page, donc UN message : deux états concurrents (« ouvert » et
  // « annulé ») laissaient le plus ancien gagner et la région finissait par contredire la
  // bannière visible. Défaut trouvé en review de FX-FOCUS.
  const slotAnnouncement = useAnnouncement();
  // The signed-in user's id: the ONLY thing the role is derived from, compared against
  // `team.captainId`. Selector form so the page re-renders on the user, not on the token.
  const currentUserId = useAuthStore((state) => state.user?.id);
  // Same route as the captain's kick — a voluntary departure is just removing yourself.
  const leaveTeam = useRemoveTeamMember(teamId);
  const cancelSlot = useCancelMatch(teamMatchesKey(teamId));

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400,
  // so the error state is rendered without spending a request — and without the red
  // "Failed to load resource" line a 400 would leave in the console.
  const validId = isValidTeamId(teamId);

  const teamQuery = useTeam(teamId, validId);
  const matchesQuery = useTeamMatches(teamId, validId);
  // ladderId only exists once the team is loaded; the hook stays disabled until then.
  const rankingsQuery = useLadderRankings(teamQuery.data?.team.ladderId);
  const { games } = useSortedGames();

  const rankings = rankingsQuery.data?.rankings;
  // `isMember` is returned at the ROOT of GET /teams/{id}/matches on purpose: it is the
  // server's answer, not something to re-derive from the roster. Unknown (loading or
  // failed) is treated as "visitor", the least-disclosing option.
  const isMember = matchesQuery.data?.isMember === true;

  if (!validId) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <TeamErrorPanel
          title="Invalid team link"
          message="This team identifier is not a valid id. Check the link you followed, or pick the team from your list."
        />
      </div>
    );
  }

  if (teamQuery.isError) {
    const status = teamQuery.error instanceof ApiError ? teamQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 404 ? (
          <TeamErrorPanel
            title="Team not found"
            message="This team does not exist any more — it may have been dissolved by its captain."
          />
        ) : (
          <TeamErrorPanel
            title="Team unavailable"
            message="This team could not be loaded. Check your connection and reload the page."
          />
        )}
      </div>
    );
  }

  if (!teamQuery.data) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <BackToTeams />
        {/* Same footprint as the loaded header so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        <p role="status" className="text-sm text-text-muted">
          Loading the team…
        </p>
      </div>
    );
  }

  const { team, members } = teamQuery.data;
  // ABSENT (not empty) for a non-member — progressive disclosure lives in the contract, so
  // there is deliberately no role check here: a visitor gets `[]` and renders nothing.
  const invitations = teamQuery.data.invitations ?? [];
  const standing = rankings ? findTeamStanding(rankings, team.id) : undefined;
  const gameName = games.find((game) => game.id === team.gameId)?.name ?? team.gameId.toUpperCase();

  // `captainId` is the server's own answer to "who runs this team" — never re-derived
  // from the roster's `isCaptain` flags, which describe the same fact one level further
  // from the source.
  const isCaptain = currentUserId === team.captainId;
  const tabs = isCaptain ? [...BASE_TABS, MANAGE_TAB] : BASE_TABS;
  // Derived at render, NOT synced in an effect: if the Manage tab disappears (the team
  // changed hands while the page was open) `activeTab` would point at a tab that no
  // longer exists, and a useEffect doing the same job is a react-hooks/set-state-in-effect
  // violation on top of rendering one dead frame.
  const currentTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : 'overview';

  function confirmLeave() {
    if (!currentUserId) return;

    leaveTeam.mutate(currentUserId, {
      onSuccess: () => {
        setLeaveConfirming(false);
        // The team still exists, so nothing in the cache turns into a 404 — unlike a
        // dissolution, the order here is free.
        void navigate({ to: '/teams' });
      },
    });
  }

  function toggleCreateMatch() {
    // A new attempt supersedes the previous confirmation: leaving "Slot opened for…" on
    // screen next to an open form would leave the captain unsure which one it describes.
    setOpenedSlotAt(null);
    slotAnnouncement.reset();
    setCreatingMatch((open) => !open);
  }

  function closeCreateMatch() {
    setCreatingMatch(false);
    createButtonRef.current?.focus();
  }

  function handleSlotCreated(scheduledAt: string) {
    slotAnnouncement.announce(
      `Slot opened for ${formatMatchDate(scheduledAt, 'long')}, now waiting for an opponent.`,
    );
    setOpenedSlotAt(scheduledAt);
    setCreatingMatch(false);
    createButtonRef.current?.focus();
  }

  function confirmCancelSlot() {
    if (!slotToCancel) return;

    // `mutate`, not `mutateAsync`: a rejection lands in `cancelSlot.error` and is rendered
    // inside the dialog, so no promise is left dangling in the handler.
    cancelSlot.mutate(slotToCancel.id, {
      onSuccess: () => {
        slotAnnouncement.announce(
          `Slot of ${formatMatchDate(slotToCancel.scheduledAt, 'long')} cancelled. It stays in the history, marked cancelled.`,
        );
        setSlotToCancel(null);
        // The confirmation may well have been describing the slot just withdrawn.
        setOpenedSlotAt(null);
      },
    });
  }

  function dismissCancelSlot() {
    cancelSlot.reset();
    setSlotToCancel(null);
  }

  function headerActions() {
    // FT-2C — the captain's ONLY header action is opening a slot. Still no « Leave team »
    // (the backend answers 400, « dissolve the team instead »: his exit is the Manage tab's
    // danger zone) and still no « Edit team », which the card asked for: the Manage tab is
    // visible to him alone, so the button was a second door into the same room and ate the
    // header's width at 375 px (David's call, 27/07).
    if (isCaptain) {
      return (
        <Button
          ref={createButtonRef}
          aria-expanded={creatingMatch}
          // Only while the panel exists: pointing at a missing id is invalid ARIA.
          aria-controls={creatingMatch ? createPanelId : undefined}
          onClick={toggleCreateMatch}
        >
          <CalendarPlus aria-hidden="true" className="mr-2 size-4" />
          Create match
        </Button>
      );
    }

    // Reached only for a NON-captain, so `isMember` alone is the plain member: a captain is
    // a member too, and the branch above has already returned for him.
    if (isMember) {
      return (
        <Button variant="danger" onClick={() => setLeaveConfirming(true)}>
          <LogOut aria-hidden="true" className="mr-2 size-4" />
          Leave team
        </Button>
      );
    }

    // Visitor: no action at all.
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <BackToTeams />

      <TeamHero
        team={team}
        gameName={gameName}
        memberCount={members.length}
        standing={standing}
        ladderSize={rankings?.length ?? 0}
        rankingsPending={rankingsQuery.isPending}
        rankingsError={rankingsQuery.isError}
        actions={headerActions()}
      />

      {isCaptain && creatingMatch && (
        <CreateMatchPanel
          id={createPanelId}
          team={team}
          members={members}
          matches={matchesQuery.data?.matches}
          onCreated={handleSlotCreated}
          onClose={closeCreateMatch}
        />
      )}

      {/* The live region is MOUNTED FOR THE WHOLE LIFE OF THE PAGE and only its text
          changes: a region inserted into the DOM together with its content is not reliably
          announced (the screen reader has to be watching the element before it fills).
          `sr-only` is `position: absolute`, so an empty region costs no layout — the visible
          banner below is a separate, purely visual element. */}
      <p role="status" className="sr-only">
        {slotAnnouncement.message}
      </p>

      {openedSlotAt && !creatingMatch && (
        // The "Next match" block only ever shows the EARLIEST open slot, so a slot opened
        // later than an existing one changes nothing on screen — this banner is what tells
        // the captain his click landed. The row itself appears in the Matches tab.
        <Callout tone="success">
          Slot opened for {formatMatchDate(openedSlotAt, 'long')} — it is now waiting for an
          opponent.
        </Callout>
      )}

      <Tabs
        tabs={tabs}
        active={currentTab}
        onSelect={setActiveTab}
        idPrefix={uid}
        label="Team sections"
      />

      {/* Every panel stays in the DOM, the inactive ones `hidden`: each tab's
          aria-controls then points at an element that really exists. */}
      <div
        ref={overviewPanelRef}
        id={panelId(uid, 'overview')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'overview')}
        hidden={currentTab !== 'overview'}
        // WAI-ARIA: a panel whose content holds no focusable element (an empty history)
        // would be unreachable right after the tab strip without this.
        tabIndex={0}
        className="focus-ring min-w-0"
      >
        <TeamOverview
          team={team}
          members={members}
          invitations={invitations}
          isMember={isMember}
          matches={matchesQuery.data?.matches}
          rankings={rankings}
          standing={standing}
          rankingsPending={rankingsQuery.isPending}
          rankingsError={rankingsQuery.isError}
          onCancelSlot={isCaptain ? setSlotToCancel : undefined}
        />
      </div>

      <div
        id={panelId(uid, 'matches')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'matches')}
        hidden={currentTab !== 'matches'}
        tabIndex={0}
        className="focus-ring min-w-0"
      >
        <TeamMatches
          matches={matchesQuery.data?.matches}
          isPending={matchesQuery.isPending}
          isError={matchesQuery.isError}
          isMember={isMember}
          onCancelSlot={isCaptain ? setSlotToCancel : undefined}
          historyRef={matchHistoryRef}
        />
      </div>

      {isCaptain && (
        <div
          id={panelId(uid, 'manage')}
          role="tabpanel"
          aria-labelledby={tabId(uid, 'manage')}
          hidden={currentTab !== 'manage'}
          tabIndex={0}
          className="focus-ring min-w-0"
        >
          <TeamManage team={team} members={members} invitations={invitations} />
        </div>
      )}

      {/* Mounted for as long as the page is: closing the dialog by unmounting it would
          leave the browser with nothing to restore focus to. */}
      <ConfirmDialog
        open={leaveConfirming}
        title="Leave this team?"
        description={
          <>
            You will be removed from <strong className="text-text-primary">{team.name}</strong>.
            Only its captain can add you back.
          </>
        }
        confirmLabel="Leave team"
        pending={leaveTeam.isPending}
        error={leaveTeam.isError ? removeTeamMemberErrorMessage(leaveTeam.error, 'leave') : null}
        onConfirm={confirmLeave}
        onCancel={() => {
          leaveTeam.reset();
          setLeaveConfirming(false);
        }}
      />

      {/* A SECOND instance next to the first, same pattern as the Manage tab: one dialog
          multiplexing both would have to re-derive which action it is showing on every
          render, for two texts that share nothing. */}
      <ConfirmDialog
        open={slotToCancel !== null}
        title="Cancel this slot?"
        description={
          <>
            The slot of{' '}
            <strong className="text-text-primary">
              {formatMatchDate(slotToCancel?.scheduledAt ?? null, 'long')}
            </strong>{' '}
            will no longer be acceptable by any team. It stays in the history, marked cancelled —
            you can open another one right away.
          </>
        }
        confirmLabel="Cancel the slot"
        cancelLabel="Keep it"
        pending={cancelSlot.isPending}
        error={cancelSlot.isError ? cancelMatchErrorMessage(cancelSlot.error) : null}
        onConfirm={confirmCancelSlot}
        onCancel={dismissCancelSlot}
        // The Cancel button lives in whichever tab is open, so the landing point follows it.
        returnFocusRef={currentTab === 'matches' ? matchHistoryRef : overviewPanelRef}
      />
    </div>
  );
}
