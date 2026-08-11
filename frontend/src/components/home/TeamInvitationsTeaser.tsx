import { Link } from '@tanstack/react-router';

import { Callout } from '@/components/ui/callout';
import { buttonClasses } from '@/components/ui/button-variants';

type TeamInvitationsTeaserProps = {
  /** Renders nothing at zero — and zero is also what an unknown count degrades to. */
  count: number;
};

/** « 2 pending team invitations » — a counter and a way in, and deliberately nothing else. */
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

        <Link to="/teams" className={buttonClasses('ghost')}>
          Answer on my teams
        </Link>
      </span>
    </Callout>
  );
}
