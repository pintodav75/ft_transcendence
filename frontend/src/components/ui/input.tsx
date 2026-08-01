import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/utils'

// ComponentPropsWithRef, not InputHTMLAttributes: same prop set PLUS `ref`, which React 19
// passes to function components like any other prop (no forwardRef). Needed as soon as a
// caller has to move focus into the field — the social panel focuses the chat composer when
// a conversation is opened from the friends list, exactly like `Button` already does for
// `ConfirmDialog`.
type InputProps = ComponentPropsWithRef<'input'>

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-control border border-border-control bg-surface-input px-4 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  )
}
