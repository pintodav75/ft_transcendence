import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

export type PillTone = 'open' | 'live' | 'dispute' | 'settled' | 'muted' | 'win' | 'loss';

const toneClasses: Record<PillTone, string> = {
  open: 'border-arena-blue/40 bg-arena-blue-soft text-arena-blue-soft-foreground',
  live: 'border-rank-gold/40 bg-rank-gold/10 text-rank-gold',
  dispute: 'border-arena-red/50 bg-arena-red-soft text-arena-red',
  settled: 'border-arena-red/30 bg-transparent text-text-secondary',
  muted: 'border-border-subtle bg-surface-input text-text-muted',
  win: 'border-success/40 bg-success/10 text-success',
  loss: 'border-arena-red/40 bg-arena-red-soft text-arena-red',
};

type PillProps = {
  tone: PillTone;
  children: ReactNode;
  className?: string;
  /** Hover text for a label kept short so the column fits (e.g. "Admin call"). */
  title?: string;
};

// Shared status chip of the team detail page (match status, dispute, recent form).
export function Pill({ tone, children, className, title }: PillProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs label-caps',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
