import type { ButtonHTMLAttributes } from 'react';

import googleLogo from '@/assets/images/google-g.png';
import { cn } from '@/lib/utils';

type GoogleAuthButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label?: string;
};

export function GoogleAuthButton({
  className,
  label = 'Google',
  type = 'button',
  ...props
}: GoogleAuthButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        // ⚠️ `border-control` : le fond noir de Google (#0a0a0a) est à 1,29:1 de la carte qui le
        // porte, donc quasi confondu avec elle — c'est le CONTOUR, et lui seul, qui dessine ce
        // bouton. WCAG 1.4.11 lui impose 3:1 ; `border-subtle` était à 1,44:1. On ne touche pas au
        // remplissage, imposé par la charte de marque Google.
        'inline-flex h-12 w-full items-center justify-center gap-2 rounded-control border border-border-control bg-google-button px-3 font-auth-provider text-sm font-semibold normal-case text-google-text transition hover:bg-surface-card-strong focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <img src={googleLogo} alt="" className="h-5 w-auto" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
