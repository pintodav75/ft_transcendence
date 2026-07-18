import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const baseClasses =
  'inline-flex h-12 items-center justify-center rounded-control px-5 text-sm font-bold uppercase transition focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-action-primary-border bg-action-primary font-semibold text-action-primary-foreground shadow-action-primary hover:bg-action-primary-hover',
  secondary:
    'border border-border-subtle bg-surface-card-strong text-text-primary hover:border-border-strong',
  ghost: 'h-auto px-0 text-xs text-text-secondary hover:text-text-primary',
};

export function Button({ className, variant = 'primary', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseClasses, variantClasses[variant], className)}
      {...props}
    />
  );
}
