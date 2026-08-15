import { cn } from '@/lib/utils';

import type { ComponentPropsWithRef } from 'react';

export type IconButtonSize = 'sm' | 'md';

const sizeClasses: Record<IconButtonSize, string> = {
  /** Inside a dense list row, next to the "⋮" trigger of `ActionMenu`, which is `size-9` too. */
  sm: 'size-9',
  /** Header / composer control: 44 px, the comfortable touch target of the social panel. */
  md: 'size-11',
};

type IconButtonProps = ComponentPropsWithRef<'button'> & {
  /**
   * REQUIRED, and the type is what enforces it: this button has no text, so without it a screen
   * reader announces "button" and voice control has nothing to say.
   */
  'aria-label': string;
  size?: IconButtonSize;
};

/** Square, icon-only, transparent-until-hover button. */
export function IconButton({
  className,
  size = 'md',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'focus-ring flex shrink-0 items-center justify-center rounded-control text-text-secondary transition hover:bg-surface-card-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
