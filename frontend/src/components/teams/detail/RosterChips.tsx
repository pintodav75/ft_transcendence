import { Crown } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { providerLabel } from '@/lib/team-detail';

import type { RequiredProvider, TeamMember } from '@/lib/team-detail';

type RosterChipsProps = {
  members: TeamMember[];
  provider: RequiredProvider;
  /** Members only: a visitor never learns who has linked their game account. */
  showAccountState: boolean;
};

export function RosterChips({ members, provider, showAccountState }: RosterChipsProps) {
  return (
    // The explicit role is required: Safari drops list semantics on a flex <ul>.
    <ul role="list" className="flex flex-wrap gap-2.5">
      {members.map((member) => (
        <li key={member.id} className="min-w-0">
          <Link
            to="/players/$pseudo"
            params={{ pseudo: member.pseudo }}
            className="focus-ring flex items-center gap-3 rounded-full border border-border-subtle bg-surface-card py-1.5 pl-1.5 pr-4 transition hover:border-border-strong hover:bg-surface-card-strong"
          >
            <Avatar
              src={member.avatarUrl ?? undefined}
              alt=""
              fallback={member.pseudo.slice(0, 2).toUpperCase()}
              className="size-9 shrink-0"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
                <span className="truncate">{member.displayName ?? member.pseudo}</span>
                {member.isCaptain && (
                  <Crown
                    role="img"
                    aria-label="Captain"
                    className="size-3.5 shrink-0 text-rank-gold"
                  />
                )}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-text-muted">
                <span className="truncate">@{member.pseudo}</span>
                {showAccountState &&
                  (member.hasLinkedAccount ? (
                    <span className="flex items-center gap-1 whitespace-nowrap text-success">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                      {providerLabel(provider)} linked
                    </span>
                  ) : (
                    <span className="whitespace-nowrap">
                      · no {providerLabel(provider)} account
                    </span>
                  ))}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
