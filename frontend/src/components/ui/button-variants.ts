import { cn } from '@/lib/utils'

// Button styling lives here (not in button.tsx) so it can be shared with elements that must be
// links for semantics — a <Link> that navigates styled like a button — without breaking Fast
// Refresh (a component file must only export components).
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const baseClasses =
  'inline-flex h-12 items-center justify-center rounded-control px-5 text-sm font-bold uppercase transition focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-action-primary-border bg-action-primary font-semibold text-action-primary-foreground shadow-action-primary hover:bg-action-primary-hover',
  // `border-control` and not `border-subtle`: a secondary button's fill is 1:1 with the card
  // behind it, so its OUTLINE is what says "this is a button" — and WCAG 1.4.11 requires 3:1 of
  // it.
  secondary:
    'border border-border-control bg-surface-card-strong text-text-primary hover:border-border-strong',
  ghost: 'h-auto px-0 text-xs text-text-secondary hover:text-text-primary',
  // `text-surface-card` and NOT `text-white`: white on `arena-red` is 3.41:1, under the 4.5:1
  // WCAG AA requires of this 14px bold label (the 3:1 threshold is for large text only — 24px,
  // or 18.66px bold).
  danger: 'bg-arena-red text-surface-card hover:brightness-110',
}

export function buttonClasses(variant: ButtonVariant = 'primary', className?: string) {
  return cn(baseClasses, variantClasses[variant], className)
}
