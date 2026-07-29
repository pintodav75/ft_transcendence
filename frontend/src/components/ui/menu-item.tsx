import type { ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

// A left-aligned nav item. If `to` is set it renders a TanStack <Link> (real
// navigation); otherwise a plain <button> (actions, or a dev-time placeholder).
// `muted` = quiet disabled-looking placeholder.
//
// Dimensions come from the /home mockup rail: 11 px gap, 9/11 px padding, 16 px icon
// (the icon size is passed by the caller). `text-sm` (14 px) is kept over the mockup's
// 13 px — one pixel is not worth a hard-coded size outside the design system.
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
    'flex w-full items-center gap-2.75 rounded-control px-2.75 py-2.25 text-sm label-caps transition',
    'focus-ring focus-visible:outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    // Transparent by default rather than absent: the ACTIVE item colours this border, and
    // a border appearing out of nowhere would shift the box by 2 px on every navigation.
    'border border-transparent',
    muted
      ? 'text-text-muted'
      : // `not-data-[status=active]` reproduces the mockup's `:hover:not(.active)`. Without
        // it, hover paints exactly what active paints, so brushing past an inactive item
        // makes it indistinguishable from the page you are actually on.
        'text-text-secondary not-data-[status=active]:hover:bg-surface-card-strong not-data-[status=active]:hover:text-text-primary',
    // État ACTIF = « la page affichée est celle de ce lien ». À ne pas confondre avec le
    // focus juste au-dessus, qui dit « mon curseur clavier est ici en ce moment » et
    // disparaît dès qu'on passe à autre chose : l'état actif, lui, reste tant qu'on est sur
    // la page, sans souris ni clavier. C'est le `<Link>` TanStack qui pose seul
    // `data-status="active"` et `aria-current="page"` sur le bon élément — il ne manquait
    // que de quoi le VOIR. La bordure (et pas seulement le fond) est ce qui le distingue du
    // survol, comme dans la maquette. Les items sans `to` sont des <button> : ils n'auront
    // jamais cet état, raison de plus pour marquer les placeholders en `muted`.
    'data-[status=active]:border-border-strong data-[status=active]:bg-surface-card-strong data-[status=active]:text-text-primary',
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
