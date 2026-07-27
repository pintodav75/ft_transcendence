import { TriangleAlert } from 'lucide-react';

import { LadderExcerpt } from '@/components/teams/detail/LadderExcerpt';
import { Pill } from '@/components/ui/pill';
import { RosterChips } from '@/components/teams/detail/RosterChips';
import { SectionTitle } from '@/components/ui/section-title';
import {
  formatLineup,
  formatMatchDate,
  nextOpenSlot,
  providerLabel,
  recentForm,
} from '@/lib/team-detail';

import type { PillTone } from '@/components/ui/pill';
import type {
  FormResult,
  RankingEntry,
  TeamDetail,
  TeamMatch,
  TeamMember,
} from '@/lib/team-detail';

const formTone: Record<FormResult, PillTone> = { win: 'win', loss: 'loss', dispute: 'dispute' };
const formLetter: Record<Exclude<FormResult, 'dispute'>, string> = { win: 'W', loss: 'L' };
const formWord: Record<FormResult, string> = {
  win: 'Win',
  loss: 'Loss',
  dispute: 'Waiting for an admin decision',
};

type TeamOverviewProps = {
  team: TeamDetail;
  members: TeamMember[];
  /** From the ROOT of GET /teams/{id}/matches — never recomputed from the roster. */
  isMember: boolean;
  matches: TeamMatch[] | undefined;
  rankings: RankingEntry[] | undefined;
  standing: RankingEntry | undefined;
  rankingsPending: boolean;
  rankingsError: boolean;
};

export function TeamOverview({
  team,
  members,
  isMember,
  matches,
  rankings,
  standing,
  rankingsPending,
  rankingsError,
}: TeamOverviewProps) {
  const openSlot = isMember && matches ? nextOpenSlot(matches) : undefined;
  const form = matches ? recentForm(matches) : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3.5">
        <SectionTitle>Roster</SectionTitle>
        <RosterChips
          members={members}
          provider={team.requiredProvider}
          showAccountState={isMember}
        />
        {isMember && (
          <p className="text-xs text-text-muted">
            A player without a linked {providerLabel(team.requiredProvider)} account cannot be
            fielded in a line-up.
          </p>
        )}
      </section>

      <LadderExcerpt
        rankings={rankings}
        standing={standing}
        teamId={team.id}
        ladderId={team.ladderId}
        ladderName={team.ladderName}
        isPending={rankingsPending}
        isError={rankingsError}
      />

      {openSlot && (
        <section className="flex flex-col gap-3.5">
          <SectionTitle>Next match</SectionTitle>
          {/* Read-only here: cancelling the slot is FT-2C. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border-y border-r border-l-2 border-border-subtle border-l-arena-blue bg-surface-card px-4 py-3">
            <p className="font-mono text-xs text-text-secondary">
              {formatMatchDate(openSlot.scheduledAt, 'long')}
            </p>
            <p className="text-sm text-text-muted">Waiting for an opponent</p>
            {openSlot.lineup && openSlot.lineup.self.length > 0 && (
              <p className="font-mono text-xs text-text-muted">
                {formatLineup(openSlot.lineup.self)}
              </p>
            )}
            <span className="ml-auto">
              <Pill tone="open">Open slot</Pill>
            </span>
          </div>
        </section>
      )}

      {form.length > 0 && (
        <section className="flex flex-col gap-3.5">
          <SectionTitle>
            Last {form.length === 1 ? 'result' : `${form.length} results`}
          </SectionTitle>
          <ul role="list" className="flex flex-wrap gap-1.5">
            {form.map((entry) => (
              <li key={entry.id}>
                <Pill tone={formTone[entry.result]} title={formWord[entry.result]}>
                  {entry.result === 'dispute' ? (
                    <TriangleAlert aria-hidden="true" className="size-3.5" />
                  ) : (
                    <span aria-hidden="true">{formLetter[entry.result]}</span>
                  )}
                  <span className="sr-only">{formWord[entry.result]}</span>
                </Pill>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
