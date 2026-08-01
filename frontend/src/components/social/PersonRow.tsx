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
   * answers, see `PresenceAvatar`. Only the friends list has a snapshot to draw from; a
   * stranger found by search or a blocked account never does.
   */
  presence?: Presence;
  /**
   * Controls at the end of the row. 🚨 THEY ARE SIBLINGS OF THE LINK, NEVER INSIDE IT: an
   * interactive element nested in an `<a>` is invalid HTML that browsers repair by silently
   * splitting the DOM, and it would be unreachable by keyboard in the bargain.
   *
   * Callers must name each one after the ROW (`Accept @bob`, not `Accept`): a column of
   * identical labels says nothing to a screen reader or to voice control.
   */
  actions?: ReactNode;
  /**
   * `false` renders the name as plain text.
   *
   * 🚨 THE BLOCK LIST NEEDS IT. `GET /users/{pseudo}` answers 404 for an account I have
   * blocked, so a link there would take the visitor to a page that cannot load — and write a
   * red line in the console on the way, which is a project-rejection criterion. Everywhere else
   * the repo's rule applies: every pseudo leads to its player page.
   */
  linkToProfile?: boolean;
  /** Names the page the player profile goes back to. Read ONCE per list, not per row. */
  backFrom?: ReturnType<typeof useBackFrom>;
  /**
   * Under 1024 px the social panel is an `aria-modal` overlay: navigating without closing it
   * would leave the visitor BEHIND the overlay, on a page they cannot reach. `undefined` on
   * desktop, where the rail is permanent.
   */
  onNavigate?: () => void;
};

/**
 * ONE PERSON, ONE LINE — the shape every list of the social rail shares: an avatar, the name,
 * and whatever can be done to that person on the right.
 *
 * Extracted by [FS-5] at its second real consumer, per the repo's rule. [FS-1] had inlined it
 * once for the friends list; this ticket needed the very same line four more times (a search
 * hit, a request received, a request sent, a blocked account), and recopying the class string
 * five times is how one of them ends up with a different truncation rule from the others.
 *
 * 🔑 THE ROW IS NOT ENTIRELY CLICKABLE, and that is the whole reason the name is a link of its
 * own rather than a button wrapping everything. The rows here have several things to do
 * (accept, decline, open the profile), so the line cannot mean one of them. `focus-within`
 * lights the whole row when any of its controls takes keyboard focus.
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
  // clears it stores an EMPTY STRING, which `??` would happily render as a blank line. Same
  // guard as the panel header, and it keeps this in step with the `&&` test below.
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

      {/* 🚨 `min-w-0` ON BOTH THIS COLUMN AND ITS PARENT, and it is not belt-and-braces:
          without either one a long pseudo refuses to shrink and pushes the actions out of the
          312 px rail — or, in a flex row, collapses the name to 0 px, a defect this project has
          now shipped twice. `truncate` only works below it. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{name}</span>
        {/* The pseudo is shown under the display name only when they differ — repeating
            "Bob / @bob" on every row costs a line and says nothing. */}
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
