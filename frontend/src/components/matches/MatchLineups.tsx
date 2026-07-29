import { RosterChips } from '@/components/teams/detail/RosterChips';
import { SectionTitle } from '@/components/ui/section-title';
import { isSoloMatch, sideName } from '@/lib/match-detail';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchLineupsProps = {
  match: MatchSheet;
  sides: MatchSide[];
};

/**
 * Who was actually FIELDED on each camp — the line-up, not the roster: a 10-player squad
 * puts five on a 5v5, and the five on the bench have no place on this sheet.
 *
 * Chips come from `RosterChips`, the team page's component, made generic for this second
 * reader instead of being copied. Two things it is NOT given here:
 *   - `showAccountState`: "has a linked Steam account" answers "may I field him?", a
 *     question already settled by the fact that this match exists — and `GET /matches/{id}`
 *     does not carry the flag, so showing it would mean inventing it;
 *   - `onKick`: nothing on this sheet is editable.
 *
 * A 1v1 renders NOTHING: the player IS the camp, already named with his avatar in the
 * scoreboard. Listing him again under a heading bearing his own name says nothing twice.
 *
 * 🚨 That skip is decided by the LADDER'S FORMAT, never by "this side has no team". A team
 * dissolved after the match leaves its side with `team: null` (`onDelete: 'set null'`), and
 * reading that as solo DROPPED the five-player line-up of a 5v5 — on the very section whose
 * job is to show it. See `isSoloMatch`.
 */
export function MatchLineups({ match, sides }: MatchLineupsProps) {
  if (isSoloMatch(match)) return null;

  const withLineup = sides.filter((side) => side.players.length > 0);
  if (withLineup.length === 0) return null;

  return (
    <section className="flex flex-col gap-6">
      {withLineup.map((side) => (
        <div key={side.id} className="flex min-w-0 flex-col gap-3.5">
          <SectionTitle>{sideName(side, false)} line-up</SectionTitle>
          <RosterChips
            members={side.players.map((player) => ({
              ...player,
              // The captain is read from the TEAM (`captainId`), the server's own answer to
              // "who runs this team" — never guessed from the order of the line-up.
              isCaptain: player.id === side.team?.captainId,
            }))}
          />
        </div>
      ))}
    </section>
  );
}
