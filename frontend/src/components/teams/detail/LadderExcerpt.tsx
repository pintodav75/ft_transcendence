import { Link } from '@tanstack/react-router';

import { LadderBoard } from '@/components/ladders/LadderBoard';
import { SectionTitle } from '@/components/ui/section-title';
import { rankingWindow } from '@/lib/ladders';

import type { RankingEntry } from '@/lib/ladders';

type LadderExcerptProps = {
  rankings: RankingEntry[] | undefined;
  /** `undefined` when the team has no ladder line yet: we then show the top of the board. */
  standing: RankingEntry | undefined;
  teamId: string;
  ladderId: string;
  ladderName: string;
  isPending: boolean;
  isError: boolean;
};

// Slice of GET /ladders/{ladderId}/rankings around the team — same cached response that
// feeds the header stats, so this costs no extra request. The rows themselves live in
// `components/ladders/`: FT-3 shows the very same board in full on the ladder page.
export function LadderExcerpt({
  rankings,
  standing,
  teamId,
  ladderId,
  ladderName,
  isPending,
  isError,
}: LadderExcerptProps) {
  const rows = rankings ? rankingWindow(rankings, standing) : [];

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle
        action={
          <Link
            to="/ladders/$ladderId"
            params={{ ladderId }}
            className="focus-ring border-b border-border-strong pb-0.5 font-sans text-[0.6875rem] normal-case tracking-normal text-text-secondary hover:text-text-primary"
          >
            See the full ladder
          </Link>
        }
      >
        {standing ? 'Ladder — around this team' : `Ladder — top of ${ladderName}`}
      </SectionTitle>

      {isPending && <p className="text-sm text-text-muted">Loading the ladder…</p>}

      {isError && (
        <p className="text-sm text-text-secondary">
          The ladder standings could not be loaded. Reload the page to try again.
        </p>
      )}

      {!isPending && !isError && rows.length === 0 && (
        <p className="text-sm text-text-muted">No team is ranked on this ladder yet.</p>
      )}

      {rows.length > 0 && (
        <LadderBoard entries={rows} selfTeamId={teamId} selfNote="(team shown on this page)" />
      )}
    </section>
  );
}
