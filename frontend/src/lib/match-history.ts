import { EM_DASH } from '@/lib/utils';

/**
 * Derivations over a LIST OF MATCH ROWS — "what is my recent form", "which slot is still
 * waiting for an opponent", "how many disputes are open", "how do I print this score".
 *
 * ⚠️ Written by FT-2A/FT-2C inside `lib/team-detail.ts`, whose only reader was a team's
 * history. [F-SOLO] is the second one: `GET /matches/me` was aligned on the very same payload
 * by B-SOLO, and the solo page asks the exact same four questions of it. They MOVED here
 * (rule of two), with no logic rewritten — only the file they live in and the shape of their
 * inputs, which is now STRUCTURAL.
 *
 * 🔑 WHY THE INPUTS ARE STRUCTURAL, AND WHY `opponent` IS TYPED `object | null`. The two
 * routes describe an opponent differently: `GET /teams/{id}/matches` serves a bare
 * `{ id, name, logoUrl }` (a team, always), `GET /matches/me` serves a union discriminated by
 * `type` (a user in 1v1, a team from 2v2 up). Nothing here reads INSIDE that object — these
 * functions only ever ask "is there an opponent at all?" — so the widest honest type is the
 * right one. Naming either concrete shape would force the other caller to lie.
 */

// ------------------------------------------------------------------ recent form

export type FormResult = 'win' | 'loss' | 'dispute';

/** What `recentForm` reads. `disputeStatus` is optional: not every payload carries it. */
export type FormMatch = {
  id: string;
  result: 'win' | 'loss' | null;
  disputeStatus?: 'open' | 'resolved' | null;
};

/**
 * Last results, most recent first — the history is already sorted by `scheduledAt`
 * DESC. Matches without an outcome (open slot, in progress) are skipped; a match an
 * admin still has to settle counts as an unknown, not as a loss.
 */
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
 * What "is this an open slot?" reads. See the module docblock for why `opponent` is
 * `object | null` rather than either route's concrete shape.
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

/**
 * The soonest slot still waiting for an opponent.
 *
 * Generic so the caller gets ITS OWN row type back — the team page needs a `TeamMatch` (to
 * read its line-up) and the solo page a `SoloMatch`, and widening the return to `SlotMatch`
 * would strip both.
 *
 * ⚠️ Members only in practice on a team ladder: the backend strips opponent-less matches from
 * a non-member's history. On a solo ladder the question does not arise — `GET /matches/me`
 * only ever returns my own matches.
 */
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

/**
 * How to render the other side of a match row.
 *
 * `kind: 'gone'` is the one that needs saying out loud: an absent opponent has several causes
 * and only some of them mean "nobody yet". A team that was dissolved, or a player who deleted
 * his account, really did play — printing an em dash there erases him in silence.
 *
 * ⚠️ Lives HERE and not in `lib/solo.ts`, where [F-SOLO] first wrote it: the type describes
 * ANY history's opponent cell (`MatchRow` renders it for a team page too), so hosting it in a
 * solo module made `components/matches/` depend on `lib/solo` — a dependency pointing the
 * wrong way. The MAPPER stays in `lib/solo.ts`: it is tied to the `GET /matches/me` payload.
 */
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
