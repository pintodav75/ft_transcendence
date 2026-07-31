import { Link } from '@tanstack/react-router';

import { Callout } from '@/components/ui/callout';
import { buttonClasses } from '@/components/ui/button-variants';

type TeamInvitationsTeaserProps = {
  /** Renders nothing at zero — and zero is also what an unknown count degrades to. */
  count: number;
};

/**
 * « 2 pending team invitations » — a counter and a way in, and deliberately nothing else.
 *
 * 🚨 NO ACCEPT / DECLINE HERE, AND THAT IS A DECISION, NOT A SHORTCUT. `TeamInvitations` is
 * already mounted on `/teams` with both actions, and it owns the cache invalidation that goes
 * with them: answering an invitation touches THREE keys (my invitations, my teams, the team
 * itself). A second copy of that mutation is a second place for those keys to drift apart — the
 * exact family of bug the invitations ticket already paid for once. One writer, one invalidation.
 *
 * The wording says how many and what it costs to act, so the reader can decide whether the trip
 * to `/teams` is worth it now.
 */
export function TeamInvitationsTeaser({ count }: TeamInvitationsTeaserProps) {
  if (count <= 0) return null;

  return (
    <Callout tone="muted">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <strong className="text-text-primary">
            {count} pending team invitation{count === 1 ? '' : 's'}
          </strong>{' '}
          — accepting one puts you on that team’s roster.
        </span>
        {/* Same idiom as a refusal's remedy link on the matchmaking board: a sentence that
            stops at a dead end is worse than one that carries the way out. */}
        <Link to="/teams" className={buttonClasses('ghost')}>
          Answer on my teams
        </Link>
      </span>
    </Callout>
  );
}
