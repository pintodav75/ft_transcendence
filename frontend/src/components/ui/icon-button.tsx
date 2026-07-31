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
   * 🚨 REQUIRED, and the type is what enforces it: this button has no text, so without it a
   * screen reader announces "button" and voice control has nothing to say. Name the ROW or the
   * TARGET, never the icon ("Send a message to @bob", not "chat bubble").
   */
  'aria-label': string;
  size?: IconButtonSize;
};

/**
 * Square, icon-only, transparent-until-hover button.
 *
 * The `Button` of the design system is a 48 px tall control with a label; this is the other
 * shape the app kept re-inlining — the rail's close and bell buttons, the "⋮" trigger of
 * `ActionMenu`. Extracted by [FS-3], which needed it three more times (close a conversation,
 * send a message, open a conversation from a friend row).
 *
 * Always rendered, never revealed on hover: a `group-hover` control is unreachable on a touch
 * screen. Disabled styling is part of the component because a send button spends real time
 * disabled — while a send is in flight, and while the socket is down.
 */
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
