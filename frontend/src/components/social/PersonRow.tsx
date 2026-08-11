import { Link } from '@tanstack/react-router';

import { PresenceAvatar } from '@/components/social/PresenceAvatar';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { useBackFrom } from '@/lib/back-navigation';
import type { Presence } from '@/lib/presence';

/**
 * What a row needs to draw somebody — and deliberately NOT a codegen type.
 *
 * The four payloads that land here (`FriendListItem`, `FriendSummary`, `BlockEntry`, a
 * `/search` hit) agree on exactly these three fields and disagree on everything else: one
 * carries a friendship id, another a block date, the search hit a discriminant. Naming the
 * intersection is what lets one row serve all four without a cast — and it keeps this
 * component from demanding an `id` it never reads.
 */
export type RowPerson = {
  pseudo: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type PersonRowProps = {
  person: RowPerson;
  /**
   * `unknown` (the default) draws no dot at all — "we do not know" and "offline" are different
   * answers, see `PresenceAvatar`.
   */
  presence?: Presence;
  /** Controls at the end of the row. */
  actions?: ReactNode;
  /** `false` renders the name as plain text. */
  linkToProfile?: boolean;
  /** Names the page the player profile goes back to. Read ONCE per list, not per row. */
  backFrom?: ReturnType<typeof useBackFrom>;
  /**
   * Under 1024 px the social panel is an `aria-modal` overlay: navigating without closing it
   * would leave the visitor BEHIND the overlay, on a page they cannot reach.
   */
  onNavigate?: () => void;
};

/**
 * ONE PERSON, ONE LINE — the shape every list of the social rail shares: an avatar, the name,
 * and whatever can be done to that person on the right.
 */
export function PersonRow({
  person,
  presence = 'unknown',
  actions,
  linkToProfile = true,
  backFrom,
  onNavigate,
}: PersonRowProps) {
  // `||` and not `??`: the API types `displayName` as nullable, but an account that has one and
  // clears it stores an EMPTY STRING, which `??` would happily render as a blank line.
  const name = person.displayName || person.pseudo;

  const identity = (
    <>
      {/* The dot is purely visual: presence is stated in words by whatever names the list. */}
      <PresenceAvatar
        src={person.avatarUrl}
        fallback={person.pseudo.slice(0, 2).toUpperCase()}
        presence={presence}
        className="size-9"
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>

        {person.displayName && person.displayName !== person.pseudo && (
          <span className="block truncate text-xs text-text-muted">@{person.pseudo}</span>
        )}
      </span>
    </>
  );

  return (
    <li
      className={cn(
        'flex items-center gap-1 rounded-control border border-transparent px-1.5 py-1 transition focus-within:border-border-subtle',
        // The hover highlight is an affordance: it belongs to a row you can actually click.
        linkToProfile && 'hover:border-border-subtle hover:bg-surface-card',
      )}
    >
      {linkToProfile ? (
        <Link
          to="/players/$pseudo"
          params={{ pseudo: person.pseudo }}
          state={backFrom}
          onClick={onNavigate}
          className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-control py-1"
        >
          {identity}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1">{identity}</span>
      )}

      {actions}
    </li>
  );
}
