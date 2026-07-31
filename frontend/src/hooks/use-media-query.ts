import { useCallback, useSyncExternalStore } from 'react';

/**
 * Does the viewport match a CSS media query, right now?
 *
 * 🔑 WHY `useSyncExternalStore` AND NOT `useEffect` + `useState`. A layout that exists in the
 * DOM only under a breakpoint (`MatchHistoryTable` mounts EITHER a table OR a list of cards,
 * never both) cannot afford a first render that lies: with an effect, the first paint would be
 * the desktop table on a phone, replaced one frame later — a visible flash, an extra render of
 * every row, and a focus/scroll position measured against markup that is already gone.
 * `matchMedia()` is SYNCHRONOUS, so the very first render can already be the right one, and
 * that is exactly what this hook is for.
 *
 * Kept free of any domain knowledge on purpose (`components/ui` rule applied to hooks): it
 * takes a query string and answers a boolean.
 *
 * ⚠️ Pass a CONSTANT query, or a memoised one: a new string on every render re-subscribes on
 * every render. Every call site here passes a literal.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  // Reading `.matches` off a fresh `MediaQueryList` is cheap and, more importantly, returns a
  // BOOLEAN: `useSyncExternalStore` compares snapshots with `Object.is`, so a primitive is what
  // keeps it from re-rendering in a loop (returning the MediaQueryList object would).
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
