import type { ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

// A left-aligned nav item. If `to` is set it renders a TanStack <Link> (real
// navigation); otherwise a plain <button> (actions, or a dev-time placeholder).
// `muted` = quiet disabled-looking placeholder.
export function MenuItem({
  children,
  to,
  muted = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  to?: LinkProps['to'];
  muted?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    'flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm label-caps transition',
    'focus-ring focus-visible:outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    muted
      ? 'text-text-muted'
      : 'text-text-secondary hover:bg-surface-card-strong hover:text-text-primary',
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
