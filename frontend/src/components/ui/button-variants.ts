import { cn } from '@/lib/utils'

// Button styling lives here (not in button.tsx) so it can be shared with
// elements that must be links for semantics — a <Link> that navigates styled
// like a button — without breaking Fast Refresh (a component file must only
// export components).
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const baseClasses =
  'inline-flex h-12 items-center justify-center rounded-control px-5 text-sm font-bold uppercase transition focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-action-primary-border bg-action-primary font-semibold text-action-primary-foreground shadow-action-primary hover:bg-action-primary-hover',
  // ⚠️ `border-control` et non `border-subtle` : le remplissage d'un bouton secondaire est à
  // 1:1 avec la carte qui le porte, c'est donc son CONTOUR qui dit « ceci est un bouton » —
  // et WCAG 1.4.11 lui impose 3:1. `border-subtle` plafonnait à 1,24:1.
  secondary:
    'border border-border-control bg-surface-card-strong text-text-primary hover:border-border-strong',
  ghost: 'h-auto px-0 text-xs text-text-secondary hover:text-text-primary',
  danger: 'bg-arena-red text-white hover:bg-arena-red/90',
}

export function buttonClasses(variant: ButtonVariant = 'primary', className?: string) {
  return cn(baseClasses, variantClasses[variant], className)
}
