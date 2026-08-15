import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { SectionTitle } from '@/components/ui/section-title';
import { claimedWinnerName, claimsContradict } from '@/lib/dispute-detail';
import { sideAvatarUrl, sideInitials, sideName } from '@/lib/match-detail';
import { useBackFrom } from '@/lib/back-navigation';

import type { DisputeSide } from '@/lib/dispute-detail';

/**
 * The camp's avatar and name, linking to its team page or to the player's page in 1v1.
 *
 * site rule: every team name and every player name is clickable. the only exceptions are when
 * there is nothing to lead to (disbanded team, deleted account), both handled below.
 * check side.team FIRST, solo SECOND, and never players[0] on a team side — a team disbanded
 * after the match leaves team: null on a 5v5 camp, and linking its first player would present
 * one of five people as the camp.
 */
function CampIdentity({
  side,
  solo,
  name,
  backFrom,
}: {
  side: DisputeSide;
  solo: boolean;
  name: string;
  backFrom: string;
}) {
  const identity = (
    <>
      <Avatar
        src={sideAvatarUrl(side, solo)}
        alt=""
        fallback={sideInitials(side, solo)}
        className="size-10 shrink-0"
      />

      <span className="min-w-0 wrap-break-word text-sm font-bold text-text-primary group-hover:underline">
        {name}
      </span>
    </>
  );

  const linkClasses =
    'group focus-ring flex min-w-0 items-center gap-3 rounded-control underline-offset-4';
  // In 1v1 a camp IS one player; on a team side the roster is not what this card names.
  const player = solo ? side.players[0] : undefined;

  if (side.team) {
    return (
      <Link to="/teams/$teamId" params={{ teamId: side.team.id }} className={linkClasses}>
        {identity}
      </Link>
    );
  }

  if (player) {
    return (
      <Link
        to="/players/$pseudo"
        params={{ pseudo: player.pseudo }}
        // Names what the player page goes back to (this dispute file).
        state={{ backFrom }}
        className={linkClasses}
      >
        {identity}
      </Link>
    );
  }

  // Disbanded team, or a camp with nobody left: there is no page to open, so no empty <a>.
  return <div className="flex min-w-0 items-center gap-3">{identity}</div>;
}

type DisputeClaimsProps = {
  sides: DisputeSide[];
  /** `isSoloMatch(file.match)` — decided by the LADDER'S FORMAT, never by a missing team. */
  solo: boolean;
};

/**
 * What each camp declared, side by side — the heart of the disagreement, and therefore the
 * first thing after the status.
 */
export function DisputeClaims({ sides, solo }: DisputeClaimsProps) {
  const contradict = claimsContradict(sides);
  // Read once at component level, never inside the map: it is a hook.
  const { backFrom } = useBackFrom();

  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <SectionTitle>What each camp claims</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        {contradict
          ? 'The two camps named different winners, which is why the match is on hold.'
          : 'The two camps reported results that do not match, which is why the match is on hold.'}
      </p>

      <ul
        role="list"
        aria-label="Reported results"
        className="grid gap-3 sm:grid-cols-2"
      >
        {sides.map((side) => {
          const name = sideName(side, solo);
          const claim = claimedWinnerName(side, sides, solo);

          return (
            <li
              key={side.id}
              className="flex min-w-0 flex-col gap-3 rounded-card border border-border-subtle bg-surface-card-strong/60 p-4"
            >
              <CampIdentity side={side} solo={solo} name={name} backFrom={backFrom} />

              <p className="min-w-0 wrap-break-word text-sm text-text-secondary">
                {claim ? (
                  <>
                    Claims <strong className="text-text-primary">{claim}</strong> won.
                  </>
                ) : (
                  // Reachable: the score route also opens a dispute from a single side in some sequences,
                  // and a settled file stays readable for ever.
                  <>No result reported by this camp.</>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
