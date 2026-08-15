import { EM_DASH } from '@/lib/utils';

/**
 * Derivations over a list of match rows: recent form, which slot is still waiting for an
 * opponent, how many disputes are open, how to print a score.
 * Shared by the team history and the solo history.
 *
 * inputs are structural, and `opponent` is typed `object | null` on purpose: the two routes
 * describe an opponent differently (GET /teams/{id}/matches serves a plain team, GET
 * /matches/me a union discriminated by `type`). nothing here reads inside that object, it only
 * asks "is there an opponent at all", so naming either concrete shape would force the other
 * caller to lie.
 */

// ------------------------------------------------------------------ recent form

export type FormResult = 'win' | 'loss' | 'dispute';

/** What `recentForm` reads. `disputeStatus` is optional: not every payload carries it. */
export type FormMatch = {
  id: string;
  result: 'win' | 'loss' | null;
  disputeStatus?: 'open' | 'resolved' | null;
};

/** Last results, most recent first — the history is already sorted by `scheduledAt` DESC. */
export function recentForm(matches: FormMatch[], limit = 5) {
  const form: { id: string; result: FormResult }[] = [];

  for (const match of matches) {
    if (match.disputeStatus === 'open') form.push({ id: match.id, result: 'dispute' });
    else if (match.result) form.push({ id: match.id, result: match.result });

    if (form.length === limit) break;
  }

  return form;
}

// ------------------------------------------------------------------- open slots

/**
 * What "is this an open slot?" reads. See the module docblock for why `opponent` is `object |
 * null` rather than either route's concrete shape.
 */
export type SlotMatch = {
  status: string;
  scheduledAt: string | null;
  opponent: object | null;
};

/** A slot the creator may still withdraw: opened by us, nobody has accepted it. */
export function isCancellableSlot(match: Pick<SlotMatch, 'status' | 'opponent'>) {
  return match.status === 'pending' && match.opponent === null;
}

/** The soonest slot still waiting for an opponent. */
export function nextOpenSlot<M extends SlotMatch>(matches: M[]): M | undefined {
  return matches
    .filter(isCancellableSlot)
    // The history arrives DESC, so plain array order would surface the LATEST slot.
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .at(0);
}

// -------------------------------------------------------------------- disputes

export function openDisputeCount(matches: { disputeStatus?: 'open' | 'resolved' | null }[]) {
  return matches.filter((match) => match.disputeStatus === 'open').length;
}

// ------------------------------------------------------------------- opponent

/** How to render the other side of a match row. */
export type MatchOpponentView =
  | { kind: 'team'; id: string; name: string }
  | { kind: 'user'; pseudo: string; name: string }
  /** There WAS an opponent and there is no page to link to any more. */
  | { kind: 'gone'; name: string }
  /** Nobody has taken this slot — or nobody ever will (it was cancelled). */
  | null;

// ------------------------------------------------------------------ formatting

/** Bo3 score, or an em dash: `null` is possible even on a completed match (admin call). */
export function formatScore(score: { self: number | null; opponent: number | null }) {
  if (score.self === null || score.opponent === null) return EM_DASH;
  return `${score.self}–${score.opponent}`;
}
