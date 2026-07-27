import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

type SectionTitleProps = {
  children: ReactNode;
  className?: string;
  /** Trailing link, past the hairline — e.g. "See the full ladder". */
  action?: ReactNode;
};

// Section heading of the "dossier" layout: small caps label followed by a hairline
// that eats the remaining width.
export function SectionTitle({ children, className, action }: SectionTitleProps) {
  return (
    // The action sits OUTSIDE the <h2>: nested in it, heading navigation announced
    // "Ladder — around this team See the full ladder" as one single heading label.
    <div className={cn('flex items-center gap-3', className)}>
      <h2 className="text-xs label-caps text-text-muted">{children}</h2>
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      {action}
    </div>
  );
}
