import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

export type CalloutTone = 'success' | 'muted' | 'danger';

const toneClasses: Record<CalloutTone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  muted: 'border-border-subtle bg-surface-card-strong/60 text-text-secondary',
  // Border + surface of the "Disputed" pill, so a match in dispute reads the same wherever
  // it is shown. The TEXT is `text-text-secondary` and not `arena-red`: MEASURED on
  // `arena-red-soft`, the red gives 4.87:1 (AA, but only just, for a whole paragraph) where
  // the secondary text gives 7.81:1 — and it is the tone every other paragraph of the app
  // already uses. The red carries the alarm through the border and the surface.
  danger: 'border-arena-red/45 bg-arena-red-soft text-text-secondary',
};

type CalloutProps = {
  /**
   * `success` for something that worked, `muted` for a neutral notice or a dead end,
   * `danger` for a state that needs someone else to act (a dispute an admin must settle).
   */
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
