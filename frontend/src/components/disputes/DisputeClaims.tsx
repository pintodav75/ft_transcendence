import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { SectionTitle } from '@/components/ui/section-title';
import { claimedWinnerName, claimsContradict } from '@/lib/dispute-detail';
import { sideAvatarUrl, sideInitials, sideName } from '@/lib/match-detail';
import { useBackFrom } from '@/lib/back-navigation';

import type { DisputeSide } from '@/lib/dispute-detail';

/**
 * The camp's avatar and name — a link to its team page, or to the player's page in 1v1.
 *
 * 🚨 RULE OF THE WHOLE SITE (David): every team name and every user name is clickable and leads
 * to its page. The only exceptions are the ones where there is nothing to lead TO, and they are
 * both handled below.
 *
 * ⚠️ `side.team` FIRST, `solo` SECOND, AND NEVER `players[0]` ON A TEAM SIDE. A team dissolved
 * after the match leaves `team: null` on a 5v5 camp (`team_id` is `set null`), and linking that
 * camp's first player would send the reader to one of five people as if he were the camp. That
 * conflation is the bug this repo has already shipped twice (FT-4A, F-SOLO).
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
      {/* `break-words`: a team name is a single unbreakable token of up to 30 characters, and
          this card is only ~290 px wide at 375 px.

          🚨 THE UNDERLINE IS CARRIED BY THE NAME, NOT BY THE LINK. `hover:underline` on the
          wrapper decorates every descendant — including the INITIALS drawn inside the avatar when
          a team has no logo, which then looks like a rendering fault. `group`/`group-hover` keeps
          the whole box clickable while only the name reacts. */}
      <span className="min-w-0 break-words text-sm font-bold text-text-primary group-hover:underline">
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
 * What each camp declared, side by side — the heart of the disagreement, and therefore the first
 * thing after the status.
 *
 * 🔑 `submittedWinnerSideId` POINTS AT A SIDE, not at a team. Resolving it through the sides list
 * is what turns "b3f2…" into "Team Alpha", and a camp can perfectly well name ITSELF or the other
 * one — which is exactly the contradiction this block exists to make visible.
 *
 * 🚨 THE CAMPS ARE NAMED BY `sideName`, THE SHARED RULE — never by reading `side.team === null` as
 * "1v1". A team dissolved after a completed match leaves a camp with `team: null` on a 5v5, and
 * reading that as solo is the bug already fixed twice (FT-4A, F-SOLO). The fallback is
 * "Disbanded team", exactly as on the match sheet.
 *
 * ⚠️ THIS BLOCK USED TO CARRY NO LINKS AT ALL, on the argument that the match sheet is one click
 * away and already links both camps. David overruled it: on this site EVERY team name and EVERY
 * user name opens its page, and someone reading a dispute must be able to go look at the camp he
 * is judging without a detour. See `CampIdentity` for the two cases that stay unlinked.
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

      {/* `role="list"` is explicit: Safari drops the list role from a `<ul>` whose display is not
          `list-item`, and this one is a grid. Named so a screen reader hears WHICH list it is.
          One column under `sm` — two 300 px cards side by side at 375 px would clip both names. */}
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

              <p className="min-w-0 break-words text-sm text-text-secondary">
                {claim ? (
                  <>
                    Claims <strong className="text-text-primary">{claim}</strong> won.
                  </>
                ) : (
                  // Reachable: B6 also opens a dispute from a single side in some sequences, and
                  // a settled file stays readable for ever. An em dash would hide the difference
                  // between "said nothing" and "said something we failed to resolve".
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
