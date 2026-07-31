import { Link } from '@tanstack/react-router';

import { useBackFrom } from '@/lib/back-navigation';
import { EM_DASH } from '@/lib/utils';

import type { MatchOpponentView } from '@/lib/match-history';

type MatchOpponentLinkProps = {
  opponent: MatchOpponentView;
};

/**
 * The other side of a match entry: a link to its team page, to its player page, or plain text.
 *
 * ⚠️ Extracted from `MatchRow` by [FX-TABLE], rule of the second use: `MatchCard` renders the
 * same four branches under `sm`. **The DOM is unchanged** — the caller keeps the emphasis
 * (`font-bold` on the cell / the card's headline), this component owns only the four branches
 * and their targets.
 *
 * The opponent's NAME goes to the opponent's page, the rest of the entry to the match sheet:
 * clicking "Bravo" has to lead to Bravo.
 *
 * ⚠️ These links are NOT gated on `canOpenSheet`: a team page is readable by any logged-in
 * account and so is a player page, so no 403 is possible. Only the MATCH sheet has a
 * participant guard.
 *
 * 🚨 `kind: 'gone'` is PLAIN TEXT and that is the whole point of the union. `opponent` being
 * null has four causes and two of them mean an opponent really did play and then vanished
 * (team dissolved, account deleted) — there is no page left to link to, but an em dash there
 * would quietly erase him. See `matchOpponentView`.
 */
export function MatchOpponentLink({ opponent }: MatchOpponentLinkProps) {
  const backFrom = useBackFrom();

  if (opponent === null) {
    // Kept to a dash: the "Open slot" pill on the same entry already says nobody has
    // accepted, and a sentence here wrapped the row over three lines.
    return <span className="font-normal text-text-muted">{EM_DASH}</span>;
  }

  if (opponent.kind === 'team') {
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: opponent.id }}
        aria-label={`Team page of ${opponent.name}`}
        // `py-1.5` lifts EVERY line fragment of the name from 16 px to 28 px without breaking
        // the wrap (an `inline-flex` would). It matters more than it looks: this target is
        // adjacent, at 0 px, to the row/card itself — which leads SOMEWHERE ELSE. A near miss
        // used to land on inert background, it now changes page.
        className="focus-ring py-1.5 underline-offset-4 hover:underline"
      >
        {opponent.name}
      </Link>
    );
  }

  if (opponent.kind === 'user') {
    return (
      <Link
        to="/players/$pseudo"
        params={{ pseudo: opponent.pseudo }}
        // Names what the player page goes back to (this history).
        state={backFrom}
        aria-label={`Player page of ${opponent.name}`}
        className="focus-ring py-1.5 underline-offset-4 hover:underline"
      >
        {opponent.name}
      </Link>
    );
  }

  return <span className="font-normal text-text-muted">{opponent.name}</span>;
}
