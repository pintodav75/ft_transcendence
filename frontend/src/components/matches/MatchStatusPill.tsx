import { Pill } from '@/components/ui/pill';
import { matchStatusView } from '@/components/matches/match-status';

import type { MatchStatusSource } from '@/components/matches/match-status';

type MatchStatusPillProps = {
  match: MatchStatusSource;
  /**
   * Second way of knowing an admin settled the outcome, for a caller whose payload carries
   * no `disputeStatus`. `GET /matches/{id}` drops `disputeId` as soon as the match leaves
   * `disputed`, but the arbitration stays legible there: the winner is set while BOTH final
   * scores remain `null` (an admin rules on a winner, not on a score — B14).
   */
  adminSettled?: boolean;
};

export function MatchStatusPill({ match, adminSettled = false }: MatchStatusPillProps) {
  const { tone, label } = matchStatusView(match);

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <Pill tone={tone}>{label}</Pill>
      {/* After arbitration the match goes back to `completed` while the dispute stays
          `resolved` — B15 exposes it whatever the status precisely so this badge can
          keep showing that an admin decided the outcome. */}
      {(adminSettled || match.disputeStatus === 'resolved') && (
        <Pill tone="settled" title="Outcome settled by an admin after a dispute">
          Admin call
        </Pill>
      )}
    </span>
  );
}
