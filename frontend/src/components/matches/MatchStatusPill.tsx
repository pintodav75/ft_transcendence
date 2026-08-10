/* The status of a match, worn as a pill — plus the « Admin call » badge when a human settled it. */

import { matchStatusView } from '@/components/matches/match-status';
import { Pill } from '@/components/ui/pill';

import type { MatchStatusSource } from '@/components/matches/match-status';

export function MatchStatusPill({
  match,
  adminSettled = false,
}: {
  match: MatchStatusSource;
  adminSettled?: boolean;
}) {
  const { tone, label } = matchStatusView(match);

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <Pill tone={tone}>{label}</Pill>
      {(adminSettled || match.disputeStatus === 'resolved') && (
        <Pill tone="settled" title="Outcome settled by an admin after a dispute">
          Admin call
        </Pill>
      )}
    </span>
  );
}
