import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { LineupPicker } from '@/components/matches/LineupPicker';
import { acceptMatchErrorMessage, isSlotGone, useAcceptMatch } from '@/lib/match-mutations';
import { formatMatchDate } from '@/lib/match-detail';
import { lineupSize } from '@/lib/matchmaking';
import { providerLabel } from '@/lib/games';
import { useTeam } from '@/lib/team-detail';

import type { OpenSlot } from '@/lib/matchmaking';

type AcceptSlotPanelProps = {
  /** Target of the opening button's `aria-controls`. */
  id: string;
  slot: OpenSlot;
  /** The team I captain on this slot's ladder — resolved by the page from `GET /teams`. */
  teamId: string;
  /** The match has started: the caller routes to its sheet. */
  onAccepted: (matchId: string) => void;
  /**
   * The slot vanished under us (another camp took it, or it passed its deadline). The panel
   * is about to be unmounted by the board's refetch, so the message has to travel UP — a
   * failure rendered inside a component that is disappearing is a message nobody reads.
   */
  onVanished: (message: string) => void;
  onClose: () => void;
};

/**
 * Composing the line-up an acceptance commits — 2v2+ only.
 *
 * An inline DISCLOSURE inside the slot's own row, not a modal: `ConfirmDialog` is a
 * confirmation box, and trapping focus around a five-checkbox form the user may well abandon
 * halfway is exactly what a native `<dialog>` should not be used for (same reasoning as
 * `CreateMatchPanel`, which opens a slot with the very same control).
 *
 * ⚠️ IT IS ONLY EVER MOUNTED ON A SLOT THE SERVER DECLARED ACCEPTABLE. `canAccept` already
 * proves I captain a team here whose roster holds enough LINKED players — so "not enough
 * players" cannot be reached from this panel, and the picker's greying is a courtesy, not the
 * gate.
 *
 * ⚠️ NO REACT HOOK FORM AND NO ZOD HERE, unlike every other form of the repo, and the reason
 * is that there is nothing for them to validate: the only rule is "exactly `size` ids", the
 * control physically cannot select more, and the submit button is disabled below it. A schema
 * would produce an error message that can never be rendered. The server's own refusals are
 * mapped by `acceptMatchErrorMessage` — that is where the real validation lives.
 */
export function AcceptSlotPanel({
  id,
  slot,
  teamId,
  onAccepted,
  onVanished,
  onClose,
}: AcceptSlotPanelProps) {
  const headingId = useId();
  const hintId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [lineup, setLineup] = useState<string[]>([]);

  const teamQuery = useTeam(teamId, true);
  const accept = useAcceptMatch();

  const size = lineupSize(slot.format);
  const members = teamQuery.data?.members ?? [];

  useEffect(() => {
    // The panel appears BELOW the button that opened it: without this a keyboard user would
    // have to tab through the rest of the row to reach the first checkbox.
    headingRef.current?.focus();
  }, []);

  function submit() {
    accept.mutate(
      { matchId: slot.id, lineup, teamId },
      {
        onSuccess: ({ match }) => onAccepted(match.id),
        onError: (error) => {
          // The board is about to drop this row (the mutation invalidates it), taking the
          // panel and its message with it. Hand the news to the page, which survives.
          if (isSlotGone(error)) onVanished(acceptMatchErrorMessage(error, members));
        },
      },
    );
  }

  const serverError =
    accept.isError && !isSlotGone(accept.error)
      ? acceptMatchErrorMessage(accept.error, members)
      : null;
  const submittable = lineup.length === size && !accept.isPending;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-control border border-border-subtle bg-surface-card-strong p-4"
    >
      {/* `tabIndex={-1}` only so focus can be MOVED here on open; it never joins the tab
          order afterwards. */}
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="focus-ring text-sm label-caps-black">
        Field your line-up · {formatMatchDate(slot.scheduledAt, 'long')}
      </h3>

      {teamQuery.isPending && (
        // Deliberately NOT a live region: the page already owns the only `role="status"` of
        // this screen (invariant #11), and two of them fight over the reader.
        <p className="text-sm text-text-muted">Loading your roster…</p>
      )}

      {teamQuery.isError && (
        // ONE block for the failure — message and way out together. They used to sit either
        // side of the `teamQuery.data` branch, under the same condition, which read as two
        // unrelated states.
        <>
          <Callout tone="danger">
            Your roster could not be loaded, so no line-up can be composed. Reload the page and
            try again.
          </Callout>
          <div className="flex">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}

      {teamQuery.data && (
        <>
          <p className="text-sm text-text-secondary">
            Accepting starts the match right away for{' '}
            <strong className="text-text-primary">{teamQuery.data.team.name}</strong> on{' '}
            {slot.ladderName}. Any open slot of yours that overlaps this one is withdrawn.
          </p>

          <LineupPicker
            members={members}
            value={lineup}
            onChange={setLineup}
            size={size}
            providerName={providerLabel(teamQuery.data.team.requiredProvider)}
            hintId={hintId}
          />

          {serverError ? <FormMessage>{serverError}</FormMessage> : null}

          <div className="flex flex-wrap gap-3">
            <Button disabled={!submittable} onClick={submit}>
              {accept.isPending ? 'Accepting…' : 'Accept the slot'}
            </Button>
            <Button variant="secondary" disabled={accept.isPending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
