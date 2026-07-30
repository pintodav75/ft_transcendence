import type { PillTone } from '@/components/ui/pill';

/**
 * Status label + colour tone of a match. Lives in its own module (same reason as
 * `button-variants.ts`) so the components that need BOTH the pill and the row's left accent
 * read a single mapping.
 *
 * ⚠️ Moved out of `components/teams/detail/` by FT-4A (rule of the second use): written for
 * a row of a team's history, it now also drives the `/matches/$matchId` sheet, and a match
 * page importing from "teams/detail" would say the opposite of what the code does. No logic
 * was rewritten — only the file it lives in, and the input became STRUCTURAL.
 */
export type MatchStatusView = {
  tone: PillTone;
  label: string;
};

/**
 * The strict minimum needed to decide, described structurally rather than by one API type:
 * the two routes that feed this mapping do not serve the same shape.
 *
 * ⚠️ `disputeStatus` is ABSENT from `GET /matches/{id}` (which only exposes `disputeId`, and
 * only while the match is `disputed`) and present whatever the status on
 * `GET /teams/{id}/matches`. It is therefore optional — a caller without it loses nothing:
 * `status === 'disputed'` is enough to read "Disputed".
 */
export type MatchStatusSource = {
  status: string;
  disputeStatus?: 'open' | 'resolved' | null;
  /**
   * `null`/absent = open slot: nobody has accepted yet.
   *
   * ⚠️ `object`, not `{ id: string }`, since [F-SOLO]: this mapping only ever reads whether
   * there IS an opponent, never anything inside it, and the two history routes describe one
   * differently (a bare team on `GET /teams/{id}/matches`, a union discriminated by `type` on
   * `GET /matches/me`). Naming a field it does not read made the solo payload unassignable
   * for no reason — the type must promise no more than the function uses.
   */
  opponent?: object | null;
};

export function matchStatusView(match: MatchStatusSource): MatchStatusView {
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
