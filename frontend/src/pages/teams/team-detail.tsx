import { useId, useState } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TeamHero } from '@/components/teams/detail/TeamHero';
import { TeamManage } from '@/components/teams/detail/TeamManage';
import { TeamMatches } from '@/components/teams/detail/TeamMatches';
import { TeamOverview } from '@/components/teams/detail/TeamOverview';
import { Tabs } from '@/components/ui/tabs';
import { panelId, tabId } from '@/components/ui/tab-ids';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSortedGames } from '@/lib/games';
import { removeTeamMemberErrorMessage, useRemoveTeamMember } from '@/lib/team-mutations';
import {
  findTeamStanding,
  isValidTeamId,
  useLadderRankings,
  useTeam,
  useTeamMatches,
} from '@/lib/team-detail';

import type { TabItem } from '@/components/ui/tabs';

const BASE_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
];

// Appended for the captain only. `Tabs` needs no change for this: it renders whatever
// array it is handed.
const MANAGE_TAB: TabItem = { id: 'manage', label: 'Manage' };

function BackToTeams() {
  return (
    <Link
      to="/teams"
      className="focus-ring inline-flex items-center gap-2 self-start text-xs label-caps text-text-secondary transition hover:text-text-primary"
    >
      <ArrowLeft className="size-4" />
      My teams
    </Link>
  );
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="panel flex flex-col items-start gap-4 p-6">
      <h1 className="text-2xl label-caps-black">{title}</h1>
      <p className="max-w-prose text-sm text-text-secondary">{message}</p>
      <Link to="/teams" className={buttonClasses('secondary')}>
        <ArrowLeft className="mr-2 size-4" />
        Back to my teams
      </Link>
    </div>
  );
}

export function TeamDetail() {
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' });
  const uid = useId();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  // The signed-in user's id: the ONLY thing the role is derived from, compared against
  // `team.captainId`. Selector form so the page re-renders on the user, not on the token.
  const currentUserId = useAuthStore((state) => state.user?.id);
  // Same route as the captain's kick — a voluntary departure is just removing yourself.
  const leaveTeam = useRemoveTeamMember(teamId);

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
        <ErrorPanel
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
          <ErrorPanel
            title="Team not found"
            message="This team does not exist any more — it may have been dissolved by its captain."
          />
        ) : (
          <ErrorPanel
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

  function headerActions() {
    // Le capitaine n'a AUCUNE action d'en-tête. Pas de « Leave team » : le back répond 400
    // (« dissolve the team instead »), sa sortie est la zone dangereuse de l'onglet Manage.
    // Pas de « Edit team » non plus, que la carte demandait : l'onglet Manage n'est visible
    // que par lui, donc le bouton n'était qu'une seconde porte vers la même pièce et
    // mangeait la largeur de l'en-tête à 375 px (décision David, 27/07).
    // Un capitaine est aussi membre, d'où le `!isCaptain`.
    if (isMember && !isCaptain) {
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
            You will be removed from <strong className="text-text-primary">{team.name}</strong>
            . Only its captain can add you back.
          </>
        }
        confirmLabel="Leave team"
        pending={leaveTeam.isPending}
        error={leaveTeam.isError ? removeTeamMemberErrorMessage(leaveTeam.error) : null}
        onConfirm={confirmLeave}
        onCancel={() => {
          leaveTeam.reset();
          setLeaveConfirming(false);
        }}
      />
    </div>
  );
}
