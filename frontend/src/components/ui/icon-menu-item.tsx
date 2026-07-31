// This is a button with only an icon, when you hover it, the LABEL is shown as tooltip.
// This is used in the Right Navigation menu.
// aria-label is for screen readers

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function IconMenuItem({
  className = '',
  children,
  label,
  onClick,
  disabled = false,
}: {
  className?: string;
  children: ReactNode;
  label: string;
  onClick?: () => void;
  /**
   * Greys the button out and takes it out of reach — for an action already in flight.
   *
   * `cursor-not-allowed` rather than `pointer-events-none` (the `MenuItem` choice) so the
   * wrapper keeps receiving hover: the tooltip is the only place the label is written, and
   * it must stay readable precisely when the button has stopped responding.
   */
  disabled?: boolean;
}) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'flex size-11 items-center justify-center rounded-control text-text-secondary focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {children}
      </button>
      {/* Tooltip, sitting to the left of the button (right-aligned nav). */}
      <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-control border border-border-subtle bg-surface-card-strong px-2 py-1 text-xs label-caps text-text-primary opacity-0 shadow-card transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}
