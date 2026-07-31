import type { ReactNode } from 'react';

/**
 * The bordered box of a short list of clickable rows — an emblem, a name, and a trailing
 * block of secondary information.
 *
 * It knows NOTHING of players, ladders or teams (it is handed `<li>`s), so by the repo's rule
 * it lands in `components/ui` straight away rather than waiting for a second use. Its two
 * readers are born together in [F-PLAYER] — the rankings list and the teams list of a player
 * profile — which is exactly the case the reuse rule exists for: two sections drawn side by
 * side from two copies of the same classes drift on the first fix applied to only one of them.
 *
 * `divide-y` rather than a `border-t` on each row: a `first:border-t-0` would be evaluated
 * against the row's own `<li>` parent, where every row is the first child, so it would silently
 * strip EVERY separator instead of just the leading one.
 */
export function RowList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-border-subtle">
      {/* `role="list"` restated because Safari drops list semantics from a styled list. */}
      <ul role="list" className="divide-y divide-border-subtle">
        {children}
      </ul>
    </div>
  );
}

/**
 * The row itself, to put on the `<Link>`.
 *
 * ⚠️ THE LINK IS THE CALLER'S, not this module's — same call as `GamePosterTile`. The two
 * lists point at different routes with different params, and TanStack Router types `to` and
 * `params` as a pair: funnelling them through a generic `href` prop would throw away the
 * type-safety that makes a broken link a compile error.
 *
 * `flex-wrap` is what makes the row survive 375 px: the trailing block below carries `w-full`,
 * so it drops onto a second line under the name instead of squeezing it to nothing (the defect
 * FT-3 measured on `LadderRow`, where the competitor's name was rendered 0 px wide).
 */
export const rowLinkClasses =
  'focus-ring flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition hover:bg-surface-card';

/**
 * The trailing block of a row (the numbers, the ladder's name).
 *
 * `w-full` forces it onto its own line below `sm`, aligned under the name by `pl-11` — 2.75 rem
 * is exactly the 2 rem emblem plus the row's 0.75 rem gap, so the second line starts where the
 * name does. From `sm` up it returns to the same line, pushed to the trailing edge by the
 * name's `flex-1`.
 */
export const rowTrailingClasses = 'flex w-full items-center gap-3 pl-11 sm:w-auto sm:pl-0';

/** The name cell: `flex-1` is what pushes the trailing block right, `min-w-0` what lets it truncate. */
export const rowNameClasses = 'flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-bold';
