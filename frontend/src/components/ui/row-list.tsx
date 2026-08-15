import type { ReactNode } from 'react';

/**
 * Bordered box for a short list of clickable rows: emblem, name, trailing secondary info.
 * Knows nothing about players, ladders or teams — you hand it <li>s.
 *
 * divide-y and not a border-t per row: first:border-t-0 would be evaluated against the row's
 * own <li> parent, where every row is the first child, so it would strip every separator
 * instead of just the top one.
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

/** The row itself, to put on the `<Link>`. */
export const rowLinkClasses =
  'focus-ring flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition hover:bg-surface-card';

/** The trailing block of a row (the numbers, the ladder's name). */
export const rowTrailingClasses = 'flex w-full items-center gap-3 pl-11 sm:w-auto sm:pl-0';

/** The name cell: `flex-1` is what pushes the trailing block right, `min-w-0` what lets it truncate. */
export const rowNameClasses = 'flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-bold';
