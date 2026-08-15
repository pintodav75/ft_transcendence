import { useId } from 'react';
import { ShieldCheck, UserCheck, UserRound } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
// `ui/stat-strip.tsx` partagé — PAS une seconde copie.
import { StatStrip } from '@/components/ui/stat-strip';
import { EM_DASH } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { PublicUser } from '@/lib/player-detail';

type PlayerHeroProps = {
  user: PublicUser;
  /** `displayName` when there is one, `pseudo` otherwise — resolved by the page. */
  name: string;
  /** Formatted account creation date, `null` when the stored value will not parse. */
  joinedOn: string | null;
  /** Formatted date the friendship was accepted, `null` when there is no accepted one. */
  friendsSince: string | null;
  /** Drives the badge only. What the visitor may DO about it is decided by the page. */
  isFriend: boolean;
  /** Relationship buttons, rendered in the identity row. */
  actions?: ReactNode;
};

/**
 * "Dossier" header of a player profile — deliberately the same silhouette as `TeamHero`: a
 * band, an avatar overlapping it, the identity, then a stats strip.
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

      <div aria-hidden="true" className="relative h-32 overflow-hidden sm:h-36">
        <div className="size-full bg-linear-to-br from-action-primary/70 via-action-primary/20 to-background-app" />

        <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
      </div>

      <div className="relative -mt-14 flex flex-wrap items-end gap-4 px-4 pb-5 sm:px-6">
        <Avatar
          src={user.avatarUrl ?? undefined}
          alt=""
          fallback={user.pseudo.slice(0, 2).toUpperCase()}
          // `text-2xl` : la taille des initiales est décidée AU POINT D'APPEL, parce que c'est
          // lui qui connaît le diamètre du cercle.
          className="size-20 shrink-0 text-2xl ring-4 ring-background-app"
        />
        <div className="min-w-0">

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

      <StatStrip
        stats={[
          // Dashed rather than dropped: every account HAS a creation date, so a missing one is
          // an unreadable value, not an absent fact.
          { label: 'Member since', value: joinedOn ?? EM_DASH },
          ...(friendsSince ? [{ label: 'Friends since', value: friendsSince }] : []),
        ]}
      />
    </section>
  );
}
