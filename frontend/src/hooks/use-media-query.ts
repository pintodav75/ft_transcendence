import { useCallback, useSyncExternalStore } from 'react';

/**
 * Does the viewport match a CSS media query, right now? Query string in, boolean out.
 *
 * useSyncExternalStore and not useEffect + useState: matchMedia() is synchronous, so the
 * first render is already right. with an effect a phone would paint the desktop table for one
 * frame. matters for callers that mount either one tree or the other, never both.
 * pass a constant query — a new string every render re-subscribes every render.
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
