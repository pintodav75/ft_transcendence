import { useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { TeamHero } from '@/components/teams/detail/TeamHero';
import { TeamMatches } from '@/components/teams/detail/TeamMatches';
import { TeamOverview } from '@/components/teams/detail/TeamOverview';
import { Tabs } from '@/components/ui/tabs';
import { panelId, tabId } from '@/components/ui/tab-ids';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { useSortedGames } from '@/lib/games';
import {
  findTeamStanding,
  isValidTeamId,
  useLadderRankings,
  useTeam,
  useTeamMatches,
} from '@/lib/team-detail';

import type { TabItem } from '@/components/ui/tabs';

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
  // Seam for FT-2B: it appends { id: 'manage', label: 'Manage' } here, shown only when
  // team.captainId === the current user. Nothing is added before its actions exist — an
  // empty tab or a dead button is exactly the debt this page replaces.
];

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
  const [activeTab, setActiveTab] = useState('overview');

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
  const standing = rankings ? findTeamStanding(rankings, team.id) : undefined;
  const gameName = games.find((game) => game.id === team.gameId)?.name ?? team.gameId.toUpperCase();

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
      />

      <Tabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        idPrefix={uid}
        label="Team sections"
      />

      {/* Both panels stay in the DOM, the inactive one `hidden`: every tab's
          aria-controls then points at an element that really exists. */}
      <div
        id={panelId(uid, 'overview')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'overview')}
        hidden={activeTab !== 'overview'}
        // WAI-ARIA: a panel whose content holds no focusable element (an empty history)
        // would be unreachable right after the tab strip without this.
        tabIndex={0}
        className="focus-ring min-w-0"
      >
        <TeamOverview
          team={team}
          members={members}
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
        hidden={activeTab !== 'matches'}
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
    </div>
  );
}
