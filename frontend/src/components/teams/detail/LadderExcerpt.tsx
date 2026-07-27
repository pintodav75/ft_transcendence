import { Link } from '@tanstack/react-router';

import { SectionTitle } from '@/components/ui/section-title';
import { Avatar } from '@/components/ui/avatar';
import {
  competitorAvatarUrl,
  competitorName,
  formatRecord,
  formatWinRate,
  isTeamCompetitor,
  rankingWindow,
} from '@/lib/team-detail';
import { cn } from '@/lib/utils';

import type { RankingEntry } from '@/lib/team-detail';

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

const rowClasses =
  'grid grid-cols-[2.5rem_1fr_3.5rem_3.5rem_2.75rem] items-center gap-3 border-l-2 border-l-transparent border-t border-t-border-subtle px-3 py-2.5 text-sm';

type LadderRowProps = {
  entry: RankingEntry;
  isSelf: boolean;
};

function LadderRow({ entry, isSelf }: LadderRowProps) {
  // The visual column header is aria-hidden (it is a grid, not a table), so each row
  // link carries its own readable summary.
  const label = `Rank ${entry.rank}, ${competitorName(entry.competitor)}, ${entry.elo} Elo, ${entry.wins} wins ${entry.losses} losses, ${formatWinRate(entry.wins, entry.losses)} win rate`;

  const cells = (
    <>
      <span className="font-mono font-bold tabular-nums text-text-muted">{entry.rank}</span>
      <span className="flex min-w-0 items-center gap-2.5 font-bold">
        <Avatar
          src={competitorAvatarUrl(entry.competitor)}
          alt=""
          fallback={competitorName(entry.competitor).slice(0, 2).toUpperCase()}
          className="size-7 shrink-0"
        />
        <span className="truncate">{competitorName(entry.competitor)}</span>
        {isSelf && <span className="sr-only">(team shown on this page)</span>}
      </span>
      <span className="font-mono font-bold tabular-nums">{entry.elo}</span>
      <span className="font-mono tabular-nums text-text-secondary">
        {formatRecord(entry.wins, entry.losses)}
      </span>
      <span className="font-mono tabular-nums text-text-secondary">
        {formatWinRate(entry.wins, entry.losses)}
      </span>
    </>
  );

  // The consulted team is highlighted and NOT a link: it would point at this very page.
  if (isSelf) {
    return (
      <div
        aria-current="true"
        className={cn(rowClasses, 'border-l-arena-red bg-action-primary/25')}
      >
        {cells}
      </div>
    );
  }

  if (isTeamCompetitor(entry.competitor)) {
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: entry.competitor.id }}
        aria-label={label}
        className={cn(rowClasses, 'focus-ring hover:bg-surface-card')}
      >
        {cells}
      </Link>
    );
  }

  return (
    <Link
      to="/players/$pseudo"
      params={{ pseudo: entry.competitor.pseudo }}
      aria-label={label}
      className={cn(rowClasses, 'focus-ring hover:bg-surface-card')}
    >
      {cells}
    </Link>
  );
}

// Slice of GET /ladders/{ladderId}/rankings around the team — same cached response that
// feeds the header stats, so this costs no extra request.
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
        <div className="overflow-hidden rounded-card border border-border-subtle">
          <div
            aria-hidden="true"
            className={cn(
              rowClasses,
              'border-t-0 bg-surface-input py-2 text-xs label-caps text-text-muted',
            )}
          >
            <span>Rank</span>
            <span>Competitor</span>
            <span>Elo</span>
            <span>W–L</span>
            <span>Rate</span>
          </div>
          <ol role="list">
            {rows.map((entry) => (
              <li key={entry.competitor.id}>
                <LadderRow
                  entry={entry}
                  isSelf={isTeamCompetitor(entry.competitor) && entry.competitor.id === teamId}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
