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
 * The bordered row that wraps a checkbox or a radio together with what it labels — a
 * click target far bigger than the 16 px control itself.
 *
 * A `<label>`, deliberately: the platform gives the whole box the control's click and focus
 * behaviour for free, where a `<div onClick>` would have to earn back the keyboard, the
 * screen-reader name and the tap target.
 *
 * Extracted at its SECOND use ([FT-4B], the match result form), from `CreateMatchPanel`'s
 * line-up picker where the same class string had been written. It knows nothing about teams,
 * matches or scores — hence `components/ui/` rather than a domain folder.
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
