import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-control border border-border-subtle bg-surface-input px-4 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  )
}
