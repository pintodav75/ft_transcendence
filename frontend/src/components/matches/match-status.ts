/**
 * Match state what to SHOW for it: the status pill and its wording, the entry's accent edge,
 * the colour of an Elo change.
 */

import type { PillTone } from '@/components/ui/pill';

export type MatchStatusView = {
  tone: PillTone;
  label: string;
};

export type MatchStatusSource = {
  status: string;
  disputeStatus?: 'open' | 'resolved' | null;
  // `null`/absent = open slot: nobody has accepted yet.
  opponent?: object | null;
};

// returns the tone of the pill, and the text to display
export function matchStatusView(match: MatchStatusSource): MatchStatusView {
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

/**
 * Colour of an Elo change: green won, red lost, quiet when there is nothing to read. `null` and
 * `0` share the quiet branch on purpose: neither is a result to celebrate.
 */
export function eloDeltaClass(eloDelta: number | null) {
  if (eloDelta === null || eloDelta === 0) return 'text-text-muted';
  return eloDelta < 0 ? 'text-arena-red' : 'text-success';
}
