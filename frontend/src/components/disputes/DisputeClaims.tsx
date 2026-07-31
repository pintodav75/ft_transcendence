import { Avatar } from '@/components/ui/avatar';
import { SectionTitle } from '@/components/ui/section-title';
import { claimedWinnerName, claimsContradict } from '@/lib/dispute-detail';
import { sideAvatarUrl, sideInitials, sideName } from '@/lib/match-detail';

import type { DisputeSide } from '@/lib/dispute-detail';

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
 * ⚠️ NO LINKS ON THESE CARDS, and it is a decision. The match sheet is one click away (the header
 * of this page links to it) and it already carries both camps WITH their team/player links, their
 * line-ups and their scores. A second set of targets here would duplicate navigation without
 * adding a capability, and would drag in the dissolved-team edge case for nothing. This block
 * answers one question: who claims what.
 */
export function DisputeClaims({ sides, solo }: DisputeClaimsProps) {
  const contradict = claimsContradict(sides);

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
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  src={sideAvatarUrl(side, solo)}
                  alt=""
                  fallback={sideInitials(side, solo)}
                  className="size-10 shrink-0"
                />
                {/* `break-words`: a team name is a single unbreakable token of up to 30
                    characters, and this card is only ~290 px wide at 375 px. */}
                <span className="min-w-0 break-words text-sm font-bold text-text-primary">
                  {name}
                </span>
              </div>

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
