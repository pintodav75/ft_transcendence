import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

type MatchLineLinkProps = {
  matchId: string;
  /**
   * Coloured left edge, from `matchAccentClass(tone)` — so a line reads the same wherever it is
   * shown. `undefined` leaves the edge neutral.
   */
  accentClass?: string;
  /**
   * Explicit accessible name, for a list where every line would otherwise be announced by the
   * same words (a ladder name and a date). Left out, the name is the concatenation of the
   * children, which is what `ActionRequired` has always relied on.
   */
  ariaLabel?: string;
  children: ReactNode;
};

/**
 * One match, as a single full-width link to its sheet.
 *
 * Extracted at its SECOND use (repo rule): written inside `ActionRequired` for the « on the
 * clock » cards of `/history`, and needed verbatim by `/home` for the « Next up » lines. The
 * alternative was copying its class string, which the reuse rule forbids — and rightly so: the
 * card is NEUTRAL with its status colour carried by the left edge alone, a balance that took
 * two attempts to get right (painting the whole card red made a match merely waiting on a
 * confirmation look like an error, and stacked two red blocks at 375 px).
 *
 * ⚠️ ONE LINK, AND NOTHING INTERACTIVE NESTED INSIDE IT. A second target inside would make a
 * line whose two halves lead to different places, and nesting an `<a>` in an `<a>` is invalid
 * HTML that browsers repair by silently splitting the DOM. Callers that need a second
 * destination (an opponent's team page, say) put it OUTSIDE this component — that is exactly
 * what [FX-ROW] had to do for the history table.
 */
export function MatchLineLink({ matchId, accentClass, ariaLabel, children }: MatchLineLinkProps) {
  return (
    <Link
      to="/matches/$matchId"
      params={{ matchId }}
      aria-label={ariaLabel}
      className={cn(
        'focus-ring flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-l-2 border-border-subtle bg-surface-card-strong/60 px-4 py-3 transition hover:bg-surface-card',
        accentClass,
      )}
    >
      {children}
    </Link>
  );
}
