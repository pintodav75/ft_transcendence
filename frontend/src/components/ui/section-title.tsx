import { cn } from '@/lib/utils';

import type { ReactNode, Ref } from 'react';

type SectionTitleProps = {
  children: ReactNode;
  className?: string;

  action?: ReactNode; // Trailing link, past the hairline — e.g. "See the full ladder".
  headingRef?: Ref<HTMLHeadingElement>;
  // Classes merged INTO the `<h2>` — in practice a type size (`text-base`, `text-lg`).
  headingClassName?: string;
};

// Section heading of the "dossier" layout: small caps label followed by a hairline that eats
// the remaining width.
export function SectionTitle({
  children,
  className,
  action,
  headingRef,
  headingClassName,
}: SectionTitleProps) {
  return (
    // The action sits OUTSIDE the <h2>: nested in it, heading navigation announced "Ladder —
    // around this team See the full ladder" as one single heading label.
    <div className={cn('flex items-center gap-3', className)}>
      {/* `tabIndex={-1}` makes the heading unfocusable by tabbing*/}
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
