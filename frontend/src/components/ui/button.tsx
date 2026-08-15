import type { ComponentPropsWithRef } from 'react'

import { buttonClasses, type ButtonVariant } from './button-variants'

// ComponentPropsWithRef, not ButtonHTMLAttributes: it is the same prop set PLUS `ref`, which
// React 19 passes to function components like any other prop (no forwardRef).
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
