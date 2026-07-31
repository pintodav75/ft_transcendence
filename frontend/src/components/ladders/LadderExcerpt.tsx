import { Link } from '@tanstack/react-router';

import { LadderBoard } from '@/components/ladders/LadderBoard';
import { SectionTitle } from '@/components/ui/section-title';
import { rankingWindow } from '@/lib/ladders';
import { sectionLinkClasses } from '@/components/ui/link-variants';

import type { RankingEntry, SelfCompetitor } from '@/lib/ladders';

type LadderExcerptProps = {
  rankings: RankingEntry[] | undefined;
  /**
   * The consulted competitor's line, or `undefined` when there is none yet: we then show the
   * top of the board. A line is created by the FIRST match RESULT — on a solo ladder there is
   * no enrolment at all, so "no line" is simply what every new account looks like.
   */
  standing: RankingEntry | undefined;
  /** Whose row to highlight — a team on `/teams/$teamId`, a player on `/solo/$ladderId`. */
  self: SelfCompetitor;
  ladderId: string;
  ladderName: string;
  isPending: boolean;
  isError: boolean;
  /** What the empty board says. The two screens rank different things. */
  emptyMessage?: string;
};

/**
 * Slice of `GET /ladders/{ladderId}/rankings` around the consulted competitor — the same
 * cached response that feeds the header stats, so this costs no extra request. The rows
 * themselves live in `LadderBoard`: the ladder page shows the very same board in full.
 *
 * ⚠️ MOVED here from `components/teams/detail/` by [F-SOLO] (rule of the second use): the solo
 * ladder page shows the same excerpt around a PLAYER, and a solo page importing
 * "teams/detail" would say the opposite of what the code does. The only behavioural change is
 * `teamId` becoming the discriminated `self` — see `LadderBoard`.
 */
export function LadderExcerpt({
  rankings,
  standing,
  self,
  ladderId,
  ladderName,
  isPending,
  isError,
  emptyMessage = 'No competitor is ranked on this ladder yet.',
}: LadderExcerptProps) {
  const rows = rankings ? rankingWindow(rankings, standing) : [];

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle
        action={
          <Link
            to="/ladders/$ladderId"
            params={{ ladderId }}
            // Moved to `sectionLinkClasses` when `/home`'s slot teaser became its second
            // reader — same rendered markup, one definition.
            className={sectionLinkClasses()}
          >
            See the full ladder
          </Link>
        }
      >
        {standing
          ? `Ladder — around ${self.type === 'team' ? 'this team' : 'you'}`
          : `Ladder — top of ${ladderName}`}
      </SectionTitle>

      {isPending && <p className="text-sm text-text-muted">Loading the ladder…</p>}

      {isError && (
        <p className="text-sm text-text-secondary">
          The ladder standings could not be loaded. Reload the page to try again.
        </p>
      )}

      {!isPending && !isError && rows.length === 0 && (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      )}

      {rows.length > 0 && (
        <LadderBoard
          entries={rows}
          self={self}
          selfNote={self.type === 'team' ? '(team shown on this page)' : '(you)'}
        />
      )}
    </section>
  );
}
