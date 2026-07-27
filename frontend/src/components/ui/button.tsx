import type { ComponentPropsWithRef } from 'react'

import { buttonClasses, type ButtonVariant } from './button-variants'

// ComponentPropsWithRef, not ButtonHTMLAttributes: it is the same prop set PLUS `ref`,
// which React 19 passes to function components like any other prop (no forwardRef).
// Needed as soon as a caller must move focus onto a button — ConfirmDialog focuses its
// Cancel button after showModal() so Enter cannot confirm a destructive action.
type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant
}

export function Button({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, className)} {...props} />
  )
}
