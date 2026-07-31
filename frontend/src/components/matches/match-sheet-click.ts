import type { MouseEvent } from 'react';

/**
 * May THIS click on a whole match entry (a table row, a mobile card) be turned into a
 * navigation to the match sheet?
 *
 * ⚠️ Extracted from `MatchRow` by [FX-TABLE], rule of the second use: under `sm` the very same
 * entry is rendered as a `MatchCard`, and the three guards below are exactly the kind of rule
 * that silently drifts once it exists in two files. No logic was rewritten.
 *
 * The click handler is only ever a CONVENIENCE on top of the date link, never a replacement:
 * a handler is not focusable and cannot be middle-clicked into a tab.
 */
export function opensMatchSheet(event: MouseEvent<HTMLElement>) {
  // A modified click asks the BROWSER for something (new tab, new window) that `navigate()`
  // cannot give: it would silently replace the current page instead. Left inert rather than
  // wrong — the date link honours all three. Middle click fires `auxclick`, never `click`, so
  // it is inert here for free.
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return false;
  }

  // Anything interactive inside the entry keeps its own target: the opponent link and the
  // Cancel button would otherwise both be swallowed by the row/card.
  // ⚠️ Keep this list in sync with what a match entry renders — a new control not listed here
  // is swallowed SILENTLY (no error, just a stray navigation).
  if (
    event.target instanceof Element &&
    event.target.closest('a,button,input,select,textarea,summary,[role="button"]')
  ) {
    return false;
  }

  // A user dragging across a pseudo or a score is selecting text, not navigating. (A
  // double-click still navigates: the first click lands before any selection exists — no
  // click-through pattern survives that, and it is not worth a timer that would delay every
  // honest click.)
  return Boolean(window.getSelection()?.isCollapsed);
}
