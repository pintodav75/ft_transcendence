import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sends focus back to a stable element after an action unmounted the control that held it.
 * Used all over /profile: saving, changing the password, toggling 2FA all destroy the button
 * that was pressed, and the browser then drops focus on <body>.
 *
 * a hook and not ref.current?.focus() at the call site: those call sites are react-hook-form
 * handleSubmit() callbacks, which run during render, and reading a ref during render is what
 * react-hooks/refs refuses. here the callback only bumps a counter and the ref is touched from
 * the effect.
 * a counter and not a boolean — two saves in a row must both move focus.
 */
export function useReturnFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    // 0 = first render. Focusing here would steal it the moment the page appears.
    if (requests === 0) return;

    ref.current?.focus();
  }, [requests]);

  const returnFocus = useCallback(() => setRequests((count) => count + 1), []);

  return { ref, returnFocus };
}
