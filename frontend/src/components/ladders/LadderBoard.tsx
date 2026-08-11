import { LadderRow, LadderRowHeader } from '@/components/ladders/LadderRow';

import type { RankingEntry, SelfCompetitor } from '@/lib/ladders';

type LadderBoardProps = {
  /** Already sorted by the backend (Elo descending) — never re-sorted here. */
  entries: RankingEntry[];
  /**
   * Whose row is highlighted instead of linked, when the board is shown on that competitor's
   * own page.
   */
  self?: SelfCompetitor;
  selfNote?: string;
};

/** The bordered standings box: header row + one row per competitor. */
export function LadderBoard({ entries, self, selfNote }: LadderBoardProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border-subtle">
      <LadderRowHeader />
      <ol role="list">
        {entries.map((entry) => (
          // `competitor.id` is a uuid and unique within one ladder: stable across refetches,
          // unlike the array index or the rank.
          <li key={entry.competitor.id}>
            <LadderRow
              entry={entry}
              isSelf={
                self !== undefined &&
                entry.competitor.type === self.type &&
                entry.competitor.id === self.id
              }
              selfNote={selfNote}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
