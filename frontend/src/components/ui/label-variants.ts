import { cn } from '@/lib/utils'

// Field-label styling lives here (not in label.tsx) so it can be shared with the elements that
// must NOT be a <label> for semantics — a <legend> labelling a fieldset, typically — without
// breaking Fast Refresh (a component file must only export components).
export function labelClasses(className?: string) {
  return cn('font-mono text-xs font-bold uppercase text-text-secondary', className)
}
