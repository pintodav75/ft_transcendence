import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

export type CalloutTone = 'success' | 'muted';

const toneClasses: Record<CalloutTone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  muted: 'border-border-subtle bg-surface-card-strong/60 text-text-secondary',
};

type CalloutProps = {
  /** `success` for something that worked, `muted` for a neutral notice or a dead end. */
  tone?: CalloutTone;
  children: ReactNode;
  /**
   * `status` when the box APPEARS as the result of an action a screen reader must hear.
   * Left out for prose that is simply part of the page. Deliberately not `alert`: a failure
   * belongs in `FormMessage`, which already carries that role and the red tone.
   */
  role?: 'status';
  className?: string;
};

// Full-width notice box: the "something happened" banner of the teams screens (team
// created, player invited, roster full). Extracted at its FOURTH occurrence — the same
// class string had been copied into two pages and two components.
export function Callout({ tone = 'muted', children, role, className }: CalloutProps) {
  return (
    <p
      role={role}
      className={cn('rounded-control border px-4 py-3 text-sm', toneClasses[tone], className)}
    >
      {children}
    </p>
  );
}
