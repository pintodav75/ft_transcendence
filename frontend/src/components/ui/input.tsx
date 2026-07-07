import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-control border border-border-subtle bg-surface-input px-4 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-action-primary-hover focus:ring-2 focus:ring-action-primary/25',
        className,
      )}
      {...props}
    />
  )
}
