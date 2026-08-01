import type { ReactNode } from 'react';

type StatProps = {
  label: string;
  /**
   * Always a string, never a number: the cell renders whatever the caller has already
   * formatted (an Elo, a `12–4` record, a `#3` rank, a date) and `EM_DASH` when the value
   * is legitimately unknown. Formatting stays where the domain is.
   */
  value: string;
  /** Trailing qualifier in a smaller, muted face — `/ 10`, `/ 128`. */
  extra?: string;
};

/**
 * One cell of a "dossier" header's stats strip.
 *
 * Extracted at its SECOND consumer (`TeamHero`, then `PlayerHero`) as the reuse rule
 * requires. It lands in `components/ui` rather than under either page's folder because it
 * holds no domain knowledge at all: a label, a value, an optional qualifier.
 *
 * `tabular-nums` is the reason this is a component and not a class list — it keeps the
 * digits on a fixed advance so a strip of several cells does not shift when one of them
 * changes width.
 */
export function Stat({ label, value, extra }: StatProps) {
  return (
    <div className="min-w-28 border-r border-border-subtle px-6 py-3.5 last:border-r-0">
      <dt className="text-xs label-caps text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-text-primary">
        {value}
        {extra && <span className="ml-1 text-sm font-normal text-text-muted">{extra}</span>}
      </dd>
    </div>
  );
}

type StatStripProps = {
  /** The `Stat` cells. They sit in a `<dl>`, so pass nothing else. */
  children: ReactNode;
  /**
   * Optional sentence past the last cell, for a state the numbers cannot express ("not
   * ranked yet", "standings could not be loaded"). Rendered OUTSIDE the `<dl>`: it is not
   * a term/description pair.
   */
  note?: ReactNode;
};

/**
 * The footer rule a hero's stats sit on.
 *
 * Extracted together with `Stat` rather than left at each call site: the four classes that
 * MAKE the strip (top rule, card background, wrapping) are exactly the kind of Tailwind
 * copy the reuse rule exists to prevent — a strip whose border stopped matching the hero's
 * would be invisible in review and obvious on screen.
 */
export function StatStrip({ children, note }: StatStripProps) {
  return (
    <div className="flex flex-wrap items-center border-t border-border-subtle bg-surface-card">
      <dl className="flex flex-wrap">{children}</dl>
      {note}
    </div>
  );
}
