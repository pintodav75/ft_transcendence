import { RosterChips } from '@/components/teams/detail/RosterChips';
import { SectionTitle } from '@/components/ui/section-title';
import { isSoloMatch, sideName } from '@/lib/match-detail';

import type { MatchSheet, MatchSide } from '@/lib/match-detail';

type MatchLineupsProps = {
  match: MatchSheet;
  sides: MatchSide[];
};

/**
 * Who was actually FIELDED on each camp — the line-up, not the roster: a 10-player squad puts
 * five on a 5v5 and the bench has no place on this sheet. Chips come from RosterChips.
 *
 * not passed here: showAccountState ("may I field him?" is already settled by the match
 * existing, and GET /matches/{id} doesn't carry the flag) and onKick (nothing is editable).
 * a 1v1 renders nothing — the player IS the camp and the scoreboard already names him.
 * that skip is decided by the ladder's FORMAT, never by "this side has no team": a team
 * disbanded after the match leaves team: null on its side, and reading that as solo drops the
 * five-man line-up of a 5v5. see isSoloMatch.
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
