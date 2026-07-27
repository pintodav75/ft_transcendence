import { Crown, UserMinus } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { providerLabel } from '@/lib/team-detail';
import { cn } from '@/lib/utils';

import type { RequiredProvider, TeamMember } from '@/lib/team-detail';

type RosterChipsProps = {
  members: TeamMember[];
  provider: RequiredProvider;
  /** Members only: a visitor never learns who has linked their game account. */
  showAccountState: boolean;
  /**
   * Captain only (Manage tab): adds a Kick button to every chip but the captain's.
   * Left out everywhere else, which is what keeps this component usable read-only in
   * the Overview tab instead of being duplicated for the manage view.
   */
  onKick?: (member: TeamMember) => void;
};

export function RosterChips({ members, provider, showAccountState, onKick }: RosterChipsProps) {
  return (
    // The explicit role is required: Safari drops list semantics on a flex <ul>.
    <ul role="list" className="flex flex-wrap gap-2.5">
      {members.map((member) => {
        // The captain has no Kick button: DELETE /teams/{id}/members/{captainId} answers
        // 400 ("captain cannot leave, dissolve the team instead"). Offering the action
        // would only produce a red console line and a dead end.
        const kickable = Boolean(onKick) && !member.isCaptain;

        return (
          // The chip's surface moved from the <Link> to the <li>: a <button> nested inside
          // an <a> is invalid HTML (Chrome complains, and the click target becomes
          // ambiguous), so the link and the Kick button must be SIBLINGS. `focus-within`
          // keeps the whole chip highlighted when either child takes keyboard focus.
          <li
            key={member.id}
            className="flex min-w-0 items-center rounded-full border border-border-subtle bg-surface-card transition focus-within:border-border-strong hover:border-border-strong hover:bg-surface-card-strong"
          >
            <Link
              to="/players/$pseudo"
              params={{ pseudo: member.pseudo }}
              className={cn(
                'focus-ring flex min-w-0 items-center gap-3 rounded-full py-1.5 pl-1.5',
                kickable ? 'pr-2' : 'pr-4',
              )}
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

            {kickable && (
              // Always visible, never revealed by hover only: on a touch screen a
              // `group-hover` action is simply unreachable.
              <button
                type="button"
                onClick={() => onKick?.(member)}
                // The visible text ("Kick") is the start of the accessible name, so
                // voice control still works while a screen reader hears WHICH player.
                aria-label={`Kick ${member.pseudo}`}
                className="focus-ring mr-1.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-arena-red/45 px-2.5 py-1 text-xs label-caps text-arena-red transition hover:bg-arena-red/10"
              >
                <UserMinus aria-hidden="true" className="size-3" />
                Kick
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
