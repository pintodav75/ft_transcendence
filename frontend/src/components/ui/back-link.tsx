import { ArrowLeft } from 'lucide-react';
import { Link, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router';

import { backLinkClasses } from '@/lib/back-navigation';

/**
 * ⚠️ A FAMILY, NOT A NAME. The origin recorded in the history entry is a path — `/solo/<id>`,
 * never "Chess 1v1": a ladder's name only exists where its data was loaded, at the top of the
 * page, and threading it down to every board row and every roster chip would cost a dozen
 * files of plumbing for one word. Decision taken with David on 30/07 — do not "improve" this
 * into a lookup that fires a request just to label a button.
 */
function backLabel(backFrom: string | undefined): string {
  if (!backFrom) return 'Back';
  if (backFrom === '/solo') return 'Solo ladders';
  if (backFrom.startsWith('/solo/')) return 'Solo ladder';
  if (backFrom === '/teams') return 'My teams';
  if (backFrom.startsWith('/teams/')) return 'Team';
  if (backFrom.startsWith('/ladders/')) return 'Standings';
  if (backFrom.startsWith('/matches/')) return 'Match sheet';

  return 'Back';
}

/**
 * Goes back to the PREVIOUS page, not to a fixed destination.
 *
 * 🔑 A player page has no parent. `/solo/$ladderId` can hard-code "Solo ladders" because a
 * solo ladder belongs to the list of solo ladders and to nothing else; a player belongs to
 * every board that links to him — a ladder standing, a team roster, a match line-up, a match
 * history row. There is no page "above" him to hard-code, which is why this one reads the
 * history instead.
 *
 * ⚠️ There is not always a previous page: a pasted link, a fresh tab. That is what
 * `useCanGoBack()` answers, and the fallback is a real link home rather than a button that
 * would do nothing when pressed. (A reload is NOT that case: reloading keeps the session
 * history and its state, so both the button and its label survive it.)
 *
 * ⚠️ A `<button>` and `history.back()`, never a `<Link to={backFrom}>`: going back restores
 * the scroll position and the tab that was open, while a fresh navigation would push a new
 * entry and reopen the page on its first tab.
 */
export function BackButton() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const backFrom = useRouterState({ select: (state) => state.location.state.backFrom });

  if (!canGoBack) {
    return (
      <Link to="/home" className={backLinkClasses}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Home
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.history.back()} className={backLinkClasses}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {backLabel(backFrom)}
    </button>
  );
}
