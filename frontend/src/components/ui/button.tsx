import type { ButtonHTMLAttributes } from 'react'

import { buttonClasses, type ButtonVariant } from './button-variants'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
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
