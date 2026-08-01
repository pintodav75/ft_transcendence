import { useId } from 'react';
import { ShieldCheck, UserCheck, UserRound } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Stat, StatStrip } from '@/components/ui/stat';
import { EM_DASH } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { PublicUser } from '@/lib/player-detail';

type PlayerHeroProps = {
  user: PublicUser;
  /** `displayName` when there is one, `pseudo` otherwise — resolved by the page. */
  name: string;
  /** Formatted account creation date, `null` when the stored value will not parse. */
  joinedOn: string | null;
  /**
   * Formatted date the friendship was accepted, `null` when there is no accepted one. The
   * cell is DROPPED rather than dashed in that case: unlike an Elo, "friends since" is not
   * a fact that exists-but-is-unknown for a stranger, it simply does not apply.
   */
  friendsSince: string | null;
  /** Drives the badge only. What the visitor may DO about it is decided by the page. */
  isFriend: boolean;
  /**
   * Relationship buttons, rendered in the identity row. The hero stays ignorant of who is
   * looking — same contract as `TeamHero`: the PAGE knows the role, this component only
   * reserves the slot.
   */
  actions?: ReactNode;
};

/**
 * "Dossier" header of a player profile — deliberately the same silhouette as `TeamHero`:
 * a band, an avatar overlapping it, the identity, then a stats strip.
 *
 * The two share `Stat`/`StatStrip` but not the whole header, because the top third differs
 * in kind: a team's band is its GAME's artwork, and a player belongs to no single game.
 */
export function PlayerHero({
  user,
  name,
  joinedOn,
  friendsSince,
  isFriend,
  actions,
}: PlayerHeroProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-subtle"
    >
      {/* ⚠️ NOT a `GameBanner`. That component needs a `gameId`, and a player has none —
          they can hold teams on several ladders at once. Rather than pick one game's
          artwork (a claim the data does not support) the band is a flat gradient built
          from the same tokens, which buys the hero's silhouette without inventing a fact.
          Decorative, hence `aria-hidden`: everything it could announce is written below. */}
      {/* `h-32 sm:h-36`, the height the ladder and match sheets give `GameBanner` — not the
          taller `h-40 sm:h-44` of the team hero. That extra height exists to give ARTWORK
          room; on a flat gradient it only renders as dead space above the avatar. */}
      <div aria-hidden="true" className="relative h-32 overflow-hidden sm:h-36">
        <div className="size-full bg-linear-to-br from-action-primary/70 via-action-primary/20 to-background-app" />
        {/* Same bottom-to-top readability veil every dossier header uses, so the avatar's
            ring meets the same value of background here as it does on the team page. */}
        <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
      </div>

      {/* `flex-wrap` + `items-end` is what makes this row survive 375 px: the actions drop
          onto their own line instead of squeezing the name to nothing. */}
      <div className="relative -mt-14 flex flex-wrap items-end gap-4 px-4 pb-5 sm:px-6">
        <Avatar
          src={user.avatarUrl ?? undefined}
          alt=""
          fallback={user.pseudo.slice(0, 2).toUpperCase()}
          className="size-20 shrink-0 ring-4 ring-background-app"
        />
        <div className="min-w-0">
          {/* Eyebrow: says WHAT this page is. Kept from the FT-2A placeholder, and placed
              band → eyebrow → h1 like the ladder and match sheets do — `TeamHero` is the
              one header without it, because a team's band already names its game. */}
          <p className="flex items-center gap-2 pb-1 text-xs label-caps text-success">
            <UserRound aria-hidden="true" className="size-4" /> Player
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <h1 id={headingId} className="truncate text-3xl label-caps-black sm:text-4xl">
              {name}
            </h1>
            {user.isAdmin && (
              <Pill tone="live">
                <ShieldCheck aria-hidden="true" className="size-3.5" /> Admin
              </Pill>
            )}
            {isFriend && (
              <Pill tone="win">
                <UserCheck aria-hidden="true" className="size-3.5" /> Friends
              </Pill>
            )}
          </div>
          <p className="mt-2 truncate font-mono text-sm text-text-secondary">@{user.pseudo}</p>
        </div>
        {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <StatStrip>
        {/* Dashed rather than dropped: every account HAS a creation date, so a missing one
            is an unreadable value, not an absent fact. Opposite call from "Friends since"
            just below — see the prop's docblock. */}
        <Stat label="Member since" value={joinedOn ?? EM_DASH} />
        {friendsSince && <Stat label="Friends since" value={friendsSince} />}
      </StatStrip>
    </section>
  );
}
