// this is the page for
// https://localhost:5173/teams/89098827-4da5-4ac5-be1d-be93e3ce8695

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

// Appended for the captain only.
const MANAGE_TAB: TabItem = { id: 'manage', label: 'Manage' };

function BackToTeams() {
  return (
    <Link to="/teams" className={backLinkClasses}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      My teams
    </Link>
  );
}

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
  const [creatingMatch, setCreatingMatch] = useState(false);
  // ISO instant of the slot just opened. Null = nothing to announce.
  const [openedSlotAt, setOpenedSlotAt] = useState<string | null>(null);
  // Holding the whole match (not just an id) is what lets the confirmation state its date.
  const [slotToCancel, setSlotToCancel] = useState<TeamMatch | null>(null);

  // accessibility stuff,
  // Focus has to come BACK to the opener when the panel closes
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const overviewPanelRef = useRef<HTMLDivElement>(null);
  const matchHistoryRef = useRef<HTMLElement>(null);

  const slotAnnouncement = useAnnouncement();

  const currentUserId = useAuthStore((state) => state.user?.id);

  // Same route as the captain's kick — a voluntary departure is just removing yourself.
  const leaveTeam = useRemoveTeamMember(teamId);
  const cancelSlot = useCancelMatch(teamMatchesKey(teamId));

  const validId = isValidTeamId(teamId);

  const teamQuery = useTeam(teamId, validId);
  const matchesQuery = useTeamMatches(teamId, validId);
  // ladderId only exists once the team is loaded; the hook stays disabled until then.
  const rankingsQuery = useLadderRankings(teamQuery.data?.team.ladderId);
  const { games } = useSortedGames();

  const rankings = rankingsQuery.data?.rankings;
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
  // ABSENT (not empty) for a non-member: a visitor gets `[]` and renders nothing.
  const invitations = teamQuery.data.invitations ?? [];
  const standing = rankings ? findTeamStanding(rankings, team.id) : undefined;
  const gameName = games.find((game) => game.id === team.gameId)?.name ?? team.gameId.toUpperCase();

  const isCaptain = currentUserId === team.captainId;
  const tabs = isCaptain ? [...BASE_TABS, MANAGE_TAB] : BASE_TABS;

  // Derived at render, NOT synced in an effect: if the Manage tab disappears (the team changed
  // hands while the page was open) `activeTab` would point at a tab that no longer exists, and
  // a useEffect doing the same job is a react-hooks/set-state-in-effect violation on top of
  // rendering one dead frame.
  const currentTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : 'overview';

  function confirmLeave() {
    if (!currentUserId) return;

    leaveTeam.mutate(currentUserId, {
      onSuccess: () => {
        setLeaveConfirming(false);
        void navigate({ to: '/teams' });
      },
    });
  }

  function toggleCreateMatch() {
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
        setOpenedSlotAt(null);
      },
    });
  }

  function dismissCancelSlot() {
    cancelSlot.reset();
    setSlotToCancel(null);
  }

  function headerActions() {
    // The captain's ONLY header action is opening a slot.
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

      <p role="status" className="sr-only">
        {slotAnnouncement.message}
      </p>

      {openedSlotAt && !creatingMatch && (
        // The "Next match" block only ever shows the EARLIEST open slot, so a slot opened later
        // than an existing one changes nothing on screen — this banner is what tells the
        // captain his click landed.
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

      <div
        ref={overviewPanelRef}
        id={panelId(uid, 'overview')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'overview')}
        hidden={currentTab !== 'overview'}
        // tab Index indicates if it can be reached when you press TAB
        // WAI-ARIA: a panel whose content holds no focusable element (an empty history) would
        // be unreachable right after the tab strip without this.
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
