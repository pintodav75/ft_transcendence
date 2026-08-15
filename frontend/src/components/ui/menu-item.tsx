import type { ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

/**
 * How the item is painted.
 *
 * `accent` is for an item that isn't part of everyone's navigation (today the admin's
 * Arbitration tab) and paints the label in arena-red. contrast on the rail's real surfaces:
 * 5.40:1 on the panel background, 5.00:1 on surface-card-strong (the hover/active fill).
 * the colour is restated for all three states on purpose — painting it once and letting the
 * shared data-[status=active]:text-text-primary stand turns the item white on its own page.
 * that's also why it's a prop and not a className from the rail: the rest/hover/active machine
 * lives in this file.
 */
export type MenuItemTone = 'default' | 'accent';

const toneClasses: Record<MenuItemTone, string> = {
  // `not-data-[status=active]` reproduces the mockup's `:hover:not(.active)`.
  default:
    'text-text-secondary not-data-[status=active]:hover:bg-surface-card-strong not-data-[status=active]:hover:text-text-primary data-[status=active]:text-text-primary',
  accent:
    'text-arena-red not-data-[status=active]:hover:bg-surface-card-strong data-[status=active]:text-arena-red',
};

// A left-aligned nav item. If `to` is set it renders a TanStack <Link> (real navigation);
// otherwise a plain <button> (actions, or a dev-time placeholder).
export function MenuItem({
  children,
  to,
  muted = false,
  disabled = false,
  tone = 'default',
  trailing,
  onClick,
}: {
  children: ReactNode;
  to?: LinkProps['to'];
  muted?: boolean;
  disabled?: boolean;
  /** See {@link MenuItemTone}. `muted` still wins over it — a placeholder is a placeholder. */
  tone?: MenuItemTone;
  /** Content pinned to the RIGHT of the label — a count badge, and nothing interactive. */
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const classes = cn(
    'flex w-full items-center gap-2.75 rounded-control px-2.75 py-2.25 text-sm label-caps transition',
    'focus-ring focus-visible:outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    // Transparent by default rather than absent: the ACTIVE item colours this border, and a
    // border appearing out of nowhere would shift the box by 2 px on every navigation.
    'border border-transparent',
    // État ACTIF = « la page affichée est celle de ce lien ».
    'data-[status=active]:border-border-strong data-[status=active]:bg-surface-card-strong',
    muted ? 'text-text-muted' : toneClasses[tone],
  );

  // `ms-auto` porté par le badge lui-même plutôt que par un espaceur : le libellé garde sa
  // largeur naturelle, donc un item SANS badge rend exactement le même DOM qu'avant l'ajout de
  // cette prop — ces boîtes se mesurent au pixel.
  const content = (
    <>
      {children}
      {trailing ? <span className="ms-auto">{trailing}</span> : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
