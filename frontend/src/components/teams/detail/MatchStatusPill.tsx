import { Pill } from '@/components/ui/pill';
import { matchStatusView } from '@/components/teams/detail/match-status';

import type { TeamMatch } from '@/lib/team-detail';

export function MatchStatusPill({ match }: { match: TeamMatch }) {
  const { tone, label } = matchStatusView(match);

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <Pill tone={tone}>{label}</Pill>
      {/* After arbitration the match goes back to `completed` while the dispute stays
          `resolved` — B15 exposes it whatever the status precisely so this badge can
          keep showing that an admin decided the outcome. */}
      {match.disputeStatus === 'resolved' && (
        <Pill tone="settled" title="Outcome settled by an admin after a dispute">
          Admin call
        </Pill>
      )}
    </span>
  );
}
