import { useRouterState } from '@tanstack/react-router';

/**
 * The origin of a navigation, carried by the history entry itself.
 *
 * 🔑 A browser never tells a page what lies behind it — `document.referrer` is empty on a
 * client-side navigation, and reading the previous entry is forbidden by design. So the
 * only way to name the destination of a "back" is to write it down when the link is
 * clicked. The history entry is the right place: it survives a reload, it is per-entry
 * (five player pages in a row each keep their own origin) and it needs no global state.
 */
declare module '@tanstack/history' {
  interface HistoryState {
    backFrom?: string;
  }
}

/**
 * The shared look of every "go back up" link, copy-pasted three times before this file
 * existed (solo ladder, team detail, match sheet).
 *
 * ⚠️ `py-1` is not cosmetic: without it the link box is 16 px tall, under the 24 px floor
 * of WCAG 2.5.8. The match sheet already carried it — with a comment saying exactly that —
 * and the two other copies had silently dropped it. Sharing the string is what stops the
 * fix from applying to one page out of three.
 */
export const backLinkClasses =
  'focus-ring inline-flex items-center gap-2 self-start py-1 text-xs label-caps text-text-secondary transition hover:text-text-primary';

/**
 * To be spread on any `<Link>` leading to a page with no parent of its own, so that page can
 * name what it goes back to: `<Link to="/players/$pseudo" state={useBackFrom()} …>`.
 *
 * ⚠️ Reactive on purpose (`useRouterState`, not a one-shot read of `router.state`): a row
 * can outlive a change of address — the same list re-rendered for another team, another
 * ladder — and a frozen origin would send the visitor back to a page he never came from,
 * silently. The selector only re-renders on a pathname change, which is rare enough that
 * the two hundred rows of a full ladder board cost nothing measurable.
 */
export function useBackFrom(): { backFrom: string } {
  const backFrom = useRouterState({ select: (state) => state.location.pathname });

  return { backFrom };
}
