import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sends focus back to a stable element after an action destroyed the control that held it.
 *
 * The need is everywhere on /profile: saving the profile, changing the password, turning 2FA
 * on or off all unmount the very button that was pressed. The browser then drops focus on
 * `<body>`, and a keyboard user is thrown back to the top of the page.
 *
 * 🔑 WHY A HOOK AND NOT `ref.current?.focus()` AT THE CALL SITE — because those call sites are
 * the callbacks handed to react-hook-form's `handleSubmit()`, and `handleSubmit()` runs DURING
 * RENDER. Reading `ref.current` from a function built at that moment is what the
 * `react-hooks/refs` rule refuses ("Cannot access refs during render"), and it is right to: a
 * ref read while rendering can be stale. Here the callback only bumps a counter — plain state
 * — and the ref is touched exclusively from the effect below, which is one of the two places
 * React allows. Same shape as `CreateSoloSlotPanel`, which focuses its heading from an effect.
 *
 * A counter rather than a boolean: two saves in a row must both move focus, and a flag already
 * `true` would not re-fire the effect.
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
