import type { LabelHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        'font-mono text-xs font-bold uppercase text-text-secondary',
        className,
      )}
      {...props}
    />
  )
}
