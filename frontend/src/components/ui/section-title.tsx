import { cn } from '@/lib/utils';

import type { ReactNode, Ref } from 'react';

type SectionTitleProps = {
  children: ReactNode;
  className?: string;
  /** Trailing link, past the hairline — e.g. "See the full ladder". */
  action?: ReactNode;
  /**
   * Handle on the `<h2>`, so a caller can move focus onto it.
   *
   * Used as a landing point when an action destroys the control that had focus (see
   * `ConfirmDialog`'s `returnFocusRef`). A heading is the right target: it is stable, it
   * NAMES the list the item was removed from, and a screen reader reads that name on
   * arrival — where a bare container would announce nothing at all.
   */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * Classes merged INTO the `<h2>` — in practice a type size (`text-base`, `text-lg`).
   *
   * Separate from `className`, which dresses the CONTAINER: a font size set there would not
   * win against the `text-xs` hard-coded on the `<h2>`. `cn` is tailwind-merge, so whatever
   * comes through here REPLACES that default; omitting it changes nothing.
   */
  headingClassName?: string;
};

// Section heading of the "dossier" layout: small caps label followed by a hairline
// that eats the remaining width.
export function SectionTitle({
  children,
  className,
  action,
  headingRef,
  headingClassName,
}: SectionTitleProps) {
  return (
    // The action sits OUTSIDE the <h2>: nested in it, heading navigation announced
    // "Ladder — around this team See the full ladder" as one single heading label.
    <div className={cn('flex items-center gap-3', className)}>
      {/* `tabIndex={-1}` makes the heading focusable BY SCRIPT ONLY — it never joins the
          tab order, so nothing changes for someone simply tabbing through the page. */}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className={cn(
          'focus-ring rounded-control text-xs label-caps text-text-muted',
          headingClassName,
        )}
      >
        {children}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      {action}
    </div>
  );
}
