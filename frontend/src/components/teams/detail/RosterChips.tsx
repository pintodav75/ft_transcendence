import { Crown, UserMinus, X } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { InlineButton } from '@/components/ui/inline-button';
import { Pill } from '@/components/ui/pill';
import { useBackFrom } from '@/lib/back-navigation';
import { providerLabel } from '@/lib/games';
import { cn } from '@/lib/utils';

import type { RequiredProvider } from '@/lib/games';
import type { TeamInvitation } from '@/lib/team-detail';

/**
 * What a chip needs to render, described STRUCTURALLY rather than as `TeamMember`.
 *
 * FT-4A is the second consumer: the match sheet lists the players FIELDED on a side, and
 * `GET /matches/{id}` serves them without `hasLinkedAccount` — that flag answers "may I put
 * him in a line-up?", a question already settled once the match exists. Re-typing the chip
 * on `TeamMember` would have forced the sheet to fabricate a `false` there, i.e. to state
 * something the server never said. `TeamMember` still satisfies this shape, so the team
 * page passes its members unchanged.
 */
export type RosterChipsMember = {
  id: string;
  pseudo: string;
  displayName: string | null;
  avatarUrl: string | null;
  isCaptain: boolean;
  /** Read ONLY when `showAccountState` is true. */
  hasLinkedAccount?: boolean;
};

/**
 * Generic over the member type so a caller gets ITS OWN type back in `onKick` — the team
 * page hands `TeamMember[]` and its handler still receives a `TeamMember`, not the widened
 * shape above (a callback parameter is contravariant, so widening it here would have broken
 * every existing caller).
 */
type RosterChipsProps<M extends RosterChipsMember> = {
  members: M[];
  /**
   * Members only: a visitor never learns who has linked their game account. The match sheet
   * leaves it out too — `GET /matches/{id}` does not carry the flag, and a fielded player
   * has by definition passed the check.
   */
  showAccountState?: boolean;
  /** Labels the account state above; only read when `showAccountState` is true. */
  provider?: RequiredProvider;
  /**
   * Captain only (Manage tab): adds a Kick button to every chip but the captain's.
   * Left out everywhere else, which is what keeps this component usable read-only in
   * the Overview tab instead of being duplicated for the manage view.
   */
  onKick?: (member: M) => void;
  /**
   * Players who have been invited and have not answered yet, rendered AFTER the members in
   * the same list. Defaults to `[]`, which is also what a visitor gets for free: the key is
   * ABSENT from `GET /teams/{id}` for a non-member, so no role check is needed here.
   */
  invitations?: TeamInvitation[];
  /**
   * Captain only (Manage tab): adds a Cancel button to every pending chip. A member of the
   * team sees the pending chips WITHOUT it — knowing who the captain has approached is
   * legitimate team information, withdrawing the invitation is not their call.
   */
  onCancelInvitation?: (invitation: TeamInvitation) => void;
};

// One shared shell for both kinds of chip: the pending one is the same object in another
// state, not another component. Only the border and the text tone change.
const chipClasses =
  'flex min-w-0 items-center rounded-full border bg-surface-card transition focus-within:border-border-strong hover:border-border-strong hover:bg-surface-card-strong';

export function RosterChips<M extends RosterChipsMember>({
  members,
  provider,
  showAccountState = false,
  onKick,
  invitations = [],
  onCancelInvitation,
}: RosterChipsProps<M>) {
  const backFrom = useBackFrom();

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
          <li key={member.id} className={cn(chipClasses, 'border-border-subtle')}>
            <Link
              to="/players/$pseudo"
              params={{ pseudo: member.pseudo }}
              // Names what the player page goes back to (this roster).
              state={backFrom}
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
                  {/* `provider &&` rather than a non-null assertion: the two props are
                      optional independently, and a caller that asks for the account state
                      without saying WHICH provider must render nothing, not "no undefined
                      account". Never reached today — the team page passes both. */}
                  {showAccountState &&
                    provider &&
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
              <InlineButton
                tone="danger"
                onClick={() => onKick?.(member)}
                // The visible text ("Kick") is the start of the accessible name, so
                // voice control still works while a screen reader hears WHICH player.
                aria-label={`Kick ${member.pseudo}`}
                className="mr-1.5"
              >
                <UserMinus aria-hidden="true" className="size-3" />
                Kick
              </InlineButton>
            )}
          </li>
        );
      })}

      {invitations.map((invitation) => {
        const cancellable = Boolean(onCancelInvitation);
        const { user } = invitation;

        return (
          // ⚠️ Keyed on the INVITATION id, not on the player's: the same player can be
          // invited, cancelled and invited again, which yields two different rows for one
          // user id — and React would reuse the wrong chip's DOM.
          //
          // A DASHED border and a fainter surface say "not settled yet" without inventing
          // a colour token for a state that is temporary by nature.
          <li
            key={invitation.id}
            className={cn(chipClasses, 'border-dashed border-border-subtle bg-surface-card/50')}
          >
            <Link
              to="/players/$pseudo"
              params={{ pseudo: user.pseudo }}
              // Names what the player page goes back to (this roster).
              state={backFrom}
              className={cn(
                'focus-ring flex min-w-0 items-center gap-3 rounded-full py-1.5 pl-1.5',
                cancellable ? 'pr-2' : 'pr-4',
              )}
            >
              <Avatar
                src={user.avatarUrl ?? undefined}
                alt=""
                fallback={user.pseudo.slice(0, 2).toUpperCase()}
                className="size-9 shrink-0"
              />
              <span className="min-w-0">
                {/* Secondary, not primary: an invited player is not on the roster yet, and
                    the two must not read as equals at a glance. No crown and no linked
                    account state either — `TeamInvitationUser` carries neither, because
                    someone who has not joined has no role in a line-up. */}
                <span className="flex items-center gap-1.5 text-sm font-bold text-text-secondary">
                  <span className="truncate">{user.displayName ?? user.pseudo}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <span className="truncate">@{user.pseudo}</span>
                  <Pill tone="muted">Pending</Pill>
                </span>
              </span>
            </Link>

            {cancellable && (
              // Deliberately NOT styled like Kick: cancelling an invitation destroys
              // nothing (the player never joined), so it stays neutral. Same reason the
              // icon is an X and not `UserMinus`.
              <InlineButton
                onClick={() => onCancelInvitation?.(invitation)}
                aria-label={`Cancel invitation to ${user.pseudo}`}
                className="mr-1.5"
              >
                <X aria-hidden="true" className="size-3" />
                Cancel
              </InlineButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}
