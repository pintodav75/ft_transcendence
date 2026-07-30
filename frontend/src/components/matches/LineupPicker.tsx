import { Avatar } from '@/components/ui/avatar';
import { OptionTile } from '@/components/ui/option-tile';
import { labelClasses } from '@/components/ui/label-variants';

/**
 * Who a caller may field. Described STRUCTURALLY rather than as `TeamMember`, for the same
 * reason `MatchHistoryMatch` is: the picker reads five fields and nothing else, so naming one
 * route's payload would force the next caller to lie about where its data comes from.
 * `GET /teams/{id}`'s `TeamMember` satisfies it as is.
 */
export type LineupCandidate = {
  id: string;
  pseudo: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  /** §5.1 — false means "cannot be fielded on this game", so the tile is greyed out. */
  hasLinkedAccount: boolean;
};

type LineupPickerProps = {
  members: LineupCandidate[];
  /** Selected ids, owned by the CALLER's form — the picker paints, it does not remember. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Handed straight to each checkbox, so React Hook Form can mark the field as touched. */
  onBlur?: () => void;
  /** Exactly this many players, decided by the ladder's format (2, 3 or 5). */
  size: number;
  /** Display name of the account §5.1 demands here ("Steam", "Riot"). */
  providerName: string;
  /** Id of the counter paragraph below — the caller points its own error at it too. */
  hintId: string;
  /** Id of the caller's error message, added to the group's description when there is one. */
  errorId?: string;
  /** Names the group. "Line-up" everywhere so far; kept a prop rather than assumed. */
  legend?: string;
};

/**
 * The line-up selector: one tile per roster member, exactly `size` of them selectable.
 *
 * ⚠️ EXTRACTED AT ITS SECOND USE ([F-MM], rule of the repo) out of
 * `components/teams/detail/CreateMatchPanel.tsx`, where the captain composes the line-up he
 * OPENS a slot with. Accepting a slot needs the very same control, with the very same §5.1
 * rule and the same cap — a second copy would have drifted the first time one of them
 * changed. **The rendered DOM is unchanged**: same `<fieldset>`, same `<legend>`, same tiles,
 * same counter sentence. Only the state moved out.
 *
 * ⚠️ `CreateMatchPanel` ITSELF WAS NOT GENERALISED, and that is a standing decision (taken on
 * [F-SOLO]): the rules are what is shared, not the markup around them. Merging two panels
 * that differ in their day/time grid, their pre-emptions and their prose would trade a real
 * merge risk for no common code.
 *
 * A `<fieldset>` (role `group`) rather than a `<div>`: it takes a description, so the counter
 * and the failure are announced WITH the group instead of floating loose next to it.
 */
export function LineupPicker({
  members,
  value,
  onChange,
  onBlur,
  size,
  providerName,
  hintId,
  errorId,
  legend = 'Line-up',
}: LineupPickerProps) {
  const fieldable = members.filter((member) => member.hasLinkedAccount).length;

  return (
    <fieldset
      aria-describedby={errorId ? `${hintId} ${errorId}` : hintId}
      className="flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      {/* A <legend>, not a <Label>: it names a GROUP of checkboxes, not one control. The look
          is shared through labelClasses() rather than by copying Label's utility string —
          same idiom as buttonClasses(). */}
      <legend className={labelClasses('mb-2')}>{legend}</legend>

      <ul role="list" className="grid gap-2 sm:grid-cols-2">
        {members.map((member) => {
          const selected = value.includes(member.id);
          // §5.1 — a player with no linked game account cannot be fielded. The 400
          // `unlinkedPlayers` is mapped anyway, for the stale-page case.
          const unlinked = !member.hasLinkedAccount;
          const atLineupLimit = !selected && value.length >= size;

          return (
            <li key={member.id} className="min-w-0">
              <OptionTile selected={selected} disabled={unlinked || atLineupLimit}>
                <input
                  type="checkbox"
                  className="focus-ring size-4 shrink-0 accent-action-primary"
                  checked={selected}
                  disabled={unlinked || atLineupLimit}
                  onBlur={onBlur}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...value, member.id]
                        : value.filter((id) => id !== member.id),
                    )
                  }
                />
                <Avatar
                  src={member.avatarUrl ?? undefined}
                  alt=""
                  fallback={member.pseudo.slice(0, 2).toUpperCase()}
                  className="size-8 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-text-primary">
                    {member.displayName ?? member.pseudo}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {unlinked ? `no ${providerName} account` : `@${member.pseudo}`}
                  </span>
                </span>
              </OptionTile>
            </li>
          );
        })}
      </ul>

      <p id={hintId} className="text-xs text-text-muted">
        {value.length}/{size} players selected
        {value.length >= size
          ? ' — unselect one to swap a player.'
          : fieldable < size
            ? ` — only ${fieldable} of your players have linked their ${providerName} account.`
            : ''}
      </p>
    </fieldset>
  );
}
