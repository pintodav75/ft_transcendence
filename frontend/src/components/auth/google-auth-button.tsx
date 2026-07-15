import type { ButtonHTMLAttributes } from 'react';

import googleLogo from '@/assets/images/google-g.png';
import { cn } from '@/lib/utils';

type GoogleAuthButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label?: string;
};

export function GoogleAuthButton({
  className,
  label = 'Continuer avec Google',
  type = 'button',
  ...props
}: GoogleAuthButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-12 w-full items-center justify-center gap-2 rounded-control border border-border-subtle bg-google-button px-3 font-auth-provider text-sm font-semibold normal-case text-google-text transition hover:bg-surface-card-strong focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <img src={googleLogo} alt="" className="h-5 w-auto" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
