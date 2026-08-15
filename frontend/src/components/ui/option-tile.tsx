import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

type OptionTileProps = {
  /** Drawn from the FORM's value, never from the DOM: the tile only paints what it is told. */
  selected: boolean;
  /** Greys the tile out. The control inside must be disabled too — this is only the skin. */
  disabled?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * The bordered row that wraps a checkbox or a radio together with what it labels — a click
 * target far bigger than the 16 px control itself.
 */
export function OptionTile({ selected, disabled = false, children, className }: OptionTileProps) {
  return (
    <label
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 transition',
        selected ? 'border-focus-ring bg-surface-card-strong' : 'border-border-subtle bg-surface-card',
        disabled && 'cursor-not-allowed opacity-50 hover:border-border-subtle',
        className,
      )}
    >
      {children}
    </label>
  );
}
