import type { ReactNode } from 'react';
import { Link, type LinkProps } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

/**
 * How the item is painted.
 *
 * `accent` exists for an item that is NOT part of everyone's navigation — today the admin's
 * Arbitration tab ([F-ADMIN]) — and it paints the label in `arena-red`, the "dispute" red the
 * rest of the app already uses. Measured on the rail's REAL surfaces: **5.40:1** on the panel
 * background (`bg-surface-card/80` composited over `background-app`) and **5.00:1** on
 * `surface-card-strong`, the hover/active fill. Both clear WCAG AA, so this adds no contrast
 * debt to the two the repo already carries.
 *
 * 🚨 THE COLOUR IS RESTATED FOR ALL THREE STATES ON PURPOSE. Painting it once and letting the
 * shared `data-[status=active]:text-text-primary` stand would turn the item WHITE on its own
 * page — precisely the screen where it must still read as an admin tab. That is also why this is
 * a PROP and not a `className` handed in by the rail: the rest/hover/active machine lives in this
 * file, and a caller re-deriving its variants from outside would get it wrong the first time they
 * move.
 */
export type MenuItemTone = 'default' | 'accent';

const toneClasses: Record<MenuItemTone, string> = {
  // `not-data-[status=active]` reproduces the mockup's `:hover:not(.active)`. Without it, hover
  // paints exactly what active paints, so brushing past an inactive item makes it
  // indistinguishable from the page you are actually on.
  default:
    'text-text-secondary not-data-[status=active]:hover:bg-surface-card-strong not-data-[status=active]:hover:text-text-primary data-[status=active]:text-text-primary',
  accent:
    'text-arena-red not-data-[status=active]:hover:bg-surface-card-strong data-[status=active]:text-arena-red',
};

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
  /**
   * Content pinned to the RIGHT of the label — a count badge, and nothing interactive.
   *
   * 🚨 NOTHING FOCUSABLE MAY GO HERE. The item is itself a `<Link>` (or a `<button>`), and
   * nesting an interactive element inside one is invalid HTML that browsers repair by silently
   * splitting the DOM. A badge is a `<span>`, which is exactly what it should be.
   *
   * ⚠️ It also becomes part of the item's ACCESSIBLE NAME, which is the concatenation of its
   * children. A bare digit would have the rail announce "Arbitration 3" — naming the unit is the
   * CALLER's job (an `sr-only` word next to the number).
   */
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const classes = cn(
    'flex w-full items-center gap-2.75 rounded-control px-2.75 py-2.25 text-sm label-caps transition',
    'focus-ring focus-visible:outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    // Transparent by default rather than absent: the ACTIVE item colours this border, and
    // a border appearing out of nowhere would shift the box by 2 px on every navigation.
    'border border-transparent',
    // État ACTIF = « la page affichée est celle de ce lien ». À ne pas confondre avec le
    // focus juste au-dessus, qui dit « mon curseur clavier est ici en ce moment » et
    // disparaît dès qu'on passe à autre chose : l'état actif, lui, reste tant qu'on est sur
    // la page, sans souris ni clavier. C'est le `<Link>` TanStack qui pose seul
    // `data-status="active"` et `aria-current="page"` sur le bon élément — il ne manquait
    // que de quoi le VOIR. La bordure (et pas seulement le fond) est ce qui le distingue du
    // survol, comme dans la maquette. Les items sans `to` sont des <button> : ils n'auront
    // jamais cet état, raison de plus pour marquer les placeholders en `muted`.
    //
    // ⚠️ La COULEUR de texte de l'état actif a migré dans `toneClasses` (F-ADMIN) : elle est la
    // seule des trois déclarations à dépendre du ton. La bordure et le fond, eux, sont communs.
    'data-[status=active]:border-border-strong data-[status=active]:bg-surface-card-strong',
    muted ? 'text-text-muted' : toneClasses[tone],
  );

  // `ms-auto` porté par le badge lui-même plutôt que par un espaceur : le libellé garde sa
  // largeur naturelle, donc un item SANS badge rend exactement le même DOM qu'avant l'ajout de
  // cette prop (`N4d` de `f-nav` mesure ces boîtes au pixel).
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
