import { useCallback, useState } from 'react';

/**
 * Text of a role="status" live region, and the function that puts it there.
 *
 * two live-region traps handled here so callers don't have to think about them:
 *  - the same text twice is not re-announced (a reader only reads what CHANGES), so the region
 *    is emptied then refilled on the next frame.
 *  - reset() clears a message an action has made false, otherwise the region contradicts the screen.
 *
 * it does NOT mount the region. that has to already be in the DOM before its text — a region
 * inserted together with its content isn't reliably announced.
 */
export function useAnnouncement() {
  const [message, setMessage] = useState('');

  const announce = useCallback((text: string) => {
    setMessage('');
    // Next frame: in the same render React would see the same value as before, the DOM would
    // not change, and nothing would be announced.
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const reset = useCallback(() => setMessage(''), []);

  return { message, announce, reset };
}
