import { useRouterState } from '@tanstack/react-router';

/**
 * The origin of a navigation, carried by the history entry itself.
 *
 * A browser never tells a page what lies behind it — `document.referrer` is empty on a
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
 * The shared look of every "go back up" link, copy-pasted three times before this file existed
 * (solo ladder, team detail, match sheet).
 */
export const backLinkClasses =
  'focus-ring inline-flex items-center gap-2 self-start py-1 text-xs label-caps text-text-secondary transition hover:text-text-primary';

/**
 * To be spread on any `<Link>` leading to a page with no parent of its own, so that page can
 * name what it goes back to: `<Link to="/players/$pseudo" state={useBackFrom()} …>`.
 */
export function useBackFrom(): { backFrom: string } {
  const backFrom = useRouterState({ select: (state) => state.location.pathname });

  return { backFrom };
}
