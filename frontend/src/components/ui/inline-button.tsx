import { cn } from '@/lib/utils';

import type { ComponentPropsWithRef } from 'react';

export type InlineButtonTone = 'danger' | 'neutral';

// `Button`/`buttonClasses` is 48 px tall (`h-12`): correct for a form, far too tall inside a
// roster chip or a table row. Rather than adding a size to the design system (which would
// invite `h-12` buttons to shrink everywhere), the pill-shaped inline action gets its own
// tiny component — the exact idiom RosterChips had inlined twice.
const baseClasses =
  'focus-ring inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs label-caps transition disabled:cursor-not-allowed disabled:opacity-50';

const toneClasses: Record<InlineButtonTone, string> = {
  // Destructive: kicking a player, cancelling a slot the team had committed to.
  danger: 'border-arena-red/45 text-arena-red hover:bg-arena-red/10',
  // Reversible: withdrawing an invitation destroys nothing, so it stays quiet.
  neutral:
    'border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary',
};

type InlineButtonProps = ComponentPropsWithRef<'button'> & {
  tone?: InlineButtonTone;
};

/**
 * Compact pill action that lives INSIDE another element (a chip, a table row).
 *
 * Always rendered, never revealed on hover: a `group-hover` action is simply unreachable on
 * a touch screen. Callers pass an `aria-label` starting with the visible text so voice
 * control still works while a screen reader hears WHICH row is being acted on.
 */
export function InlineButton({
  className,
  tone = 'neutral',
  type = 'button',
  ...props
}: InlineButtonProps) {
  return <button type={type} className={cn(baseClasses, toneClasses[tone], className)} {...props} />;
}
