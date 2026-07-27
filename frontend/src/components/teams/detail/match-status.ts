import type { PillTone } from '@/components/ui/pill';
import type { TeamMatch } from '@/lib/team-detail';

// Status label + colour tone of one match row. Lives in its own module (same reason as
// button-variants.ts) so the components that need BOTH the pill and the row's left
// accent read a single mapping.
export type MatchStatusView = {
  tone: PillTone;
  label: string;
};

export function matchStatusView(match: TeamMatch): MatchStatusView {
  // An open dispute outranks the raw status: the row must read "disputed" even while
  // the match itself is still `in_progress`.
  if (match.disputeStatus === 'open' || match.status === 'disputed') {
    return { tone: 'dispute', label: 'Disputed' };
  }

  switch (match.status) {
    case 'pending':
      return match.opponent
        ? { tone: 'open', label: 'Scheduled' }
        : { tone: 'open', label: 'Open slot' };
    case 'in_progress':
      return { tone: 'live', label: 'In progress' };
    case 'awaiting_confirmation':
      return { tone: 'live', label: 'Awaiting result' };
    case 'completed':
      return { tone: 'muted', label: 'Completed' };
    case 'cancelled':
      return { tone: 'muted', label: 'Cancelled' };
    // `status` is a plain string in the contract, so an unknown value is possible:
    // show it as-is rather than swallowing the row.
    default:
      return { tone: 'muted', label: match.status };
  }
}

const accentClasses: Record<PillTone, string> = {
  open: 'border-l-arena-blue',
  live: 'border-l-rank-gold',
  dispute: 'border-l-arena-red',
  settled: 'border-l-transparent',
  muted: 'border-l-transparent',
  win: 'border-l-success',
  loss: 'border-l-arena-red',
};

/** Coloured left edge of a match row, matching its status pill. */
export function matchAccentClass(tone: PillTone) {
  return accentClasses[tone];
}
