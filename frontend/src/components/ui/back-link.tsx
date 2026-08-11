import { ArrowLeft } from 'lucide-react';
import { Link, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router';

import { backLinkClasses } from '@/lib/back-navigation';

/**
 * A FAMILY, NOT A NAME. The origin recorded in the history entry is a path — `/solo/<id>`,
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

/** Goes back to the PREVIOUS page, not to a fixed destination. */
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
