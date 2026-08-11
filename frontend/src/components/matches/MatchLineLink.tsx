/*
 * One match as a single full-width link — to its sheet, or to its dispute file. The « on the
 * clock » lines of `/history` and the « Next up » lines of `/home` are both made of these.
 */

import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

/** Where the line leads. */
export type MatchLineTarget =
  | { kind: 'match'; matchId: string }
  | { kind: 'dispute'; disputeId: string };

type MatchLineLinkProps = {
  target: MatchLineTarget;
  /**
   * Coloured left edge, from `matchAccentClass(tone)` — so a line reads the same wherever it is
   * shown. `undefined` leaves the edge neutral.
   */
  accentClass?: string;
  /**
   * Explicit accessible name, for a list where every line would otherwise be announced by the
   * same words (a ladder name and a date).
   */
  ariaLabel?: string;
  children: ReactNode;
};

/** ONE LINK, AND NOTHING INTERACTIVE NESTED INSIDE IT. */
export function MatchLineLink({ target, accentClass, ariaLabel, children }: MatchLineLinkProps) {
  const className = cn(
    'focus-ring flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-l-2 border-border-subtle bg-surface-card-strong/60 px-4 py-3 transition hover:bg-surface-card',
    accentClass,
  );

  // Two `<Link>`s rather than one with a computed `to`: TanStack ties `params` to the literal
  // route path, so a union there is not type-checkable — and losing that check is exactly how a
  // route rename ends up producing a link to nowhere at runtime.
  if (target.kind === 'dispute') {
    return (
      <Link
        to="/disputes/$disputeId"
        params={{ disputeId: target.disputeId }}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      to="/matches/$matchId"
      params={{ matchId: target.matchId }}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </Link>
  );
}
