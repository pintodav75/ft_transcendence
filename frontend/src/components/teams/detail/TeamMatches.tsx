import { MatchRow } from '@/components/teams/detail/MatchRow';
import { hasLineups, openDisputeCount } from '@/lib/team-detail';

import type { Ref } from 'react';
import type { TeamMatch } from '@/lib/team-detail';

type TeamMatchesProps = {
  matches: TeamMatch[] | undefined;
  isPending: boolean;
  isError: boolean;
  isMember: boolean;
  /**
   * Captain only: opens the confirmation for withdrawing an open slot. Its mere presence
   * is what adds the actions column — the role check lives on the page, not here.
   */
  onCancelSlot?: (match: TeamMatch) => void;
  /**
   * Handle sur la région « Match history », utilisée comme point d'atterrissage du focus
   * après une annulation de créneau (cf. `ConfirmDialog.returnFocusRef`) : la ligne qui
   * portait le bouton disparaît, cette région NOMME la liste d'où elle vient de partir.
   * Elle est déjà `tabIndex={0}` pour son défilement horizontal — rien à ajouter.
   */
  historyRef?: Ref<HTMLDivElement>;
};

// Match history tab. Entering a result and attaching dispute evidence stay out: both need
// the winning SIDE's id, which this route does not expose — they belong to /matches/$matchId.
export function TeamMatches({
  matches,
  isPending,
  isError,
  isMember,
  onCancelSlot,
  historyRef,
}: TeamMatchesProps) {
  if (isPending) {
    return <p className="text-sm text-text-muted">Loading the match history…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-text-secondary">
        The match history could not be loaded. Reload the page to try again.
      </p>
    );
  }

  const list = matches ?? [];

  if (list.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        {isMember
          ? 'No match yet — this team has not played or opened a slot.'
          : 'No public match yet: only matches an opponent has accepted are listed here.'}
      </p>
    );
  }

  // Derived from the DATA, not from `isMember`: `lineup` is ABSENT (not null) for a
  // non-member, and an empty column header would be a lie.
  const showLineup = hasLineups(list);
  const disputes = openDisputeCount(list);
  const showActions = Boolean(onCancelSlot);

  return (
    <div className="flex flex-col gap-4">
      {isMember && disputes > 0 && (
        <p
          role="status"
          className="rounded-card border border-arena-red/45 bg-arena-red-soft px-4 py-3 text-sm text-text-secondary"
        >
          <span className="font-semibold text-text-primary">
            {disputes === 1 ? '1 match in dispute.' : `${disputes} matches in dispute.`}
          </span>{' '}
          Both sides reported a different winner, so an admin has to settle it.
        </p>
      )}

      {/*
        The table scrolls inside its own box: the page itself never scrolls sideways. It is
        focusable and labelled on purpose — below ~600px the Status column sits outside the
        viewport, and a scroll container that cannot take focus makes its hidden content
        unreachable by keyboard (WCAG 2.1.1).

        ⚠️ `relative` is LOAD-BEARING, not decoration. `sr-only` is `position: absolute`, and
        an absolutely positioned box is only clipped by an ancestor that is its CONTAINING
        BLOCK. With a static container, the screen-reader-only text of the Actions header
        (a 1 px box laid out ~628 px in, i.e. past the viewport) resolved against the initial
        containing block and stretched the DOCUMENT's scroll width by 253 px at 375 px —
        measured. Making this box positioned brings those descendants back under its
        overflow, which is what keeps the page itself from scrolling sideways.
      */}
      <div
        ref={historyRef}
        tabIndex={0}
        role="region"
        aria-label="Match history, scroll sideways to see every column"
        className="focus-ring relative overflow-x-auto"
      >
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">Match history, most recent first</caption>
          <thead>
            <tr className="text-xs label-caps text-text-muted">
              <th scope="col" className="px-3 pb-2.5 font-semibold">
                Date
              </th>
              <th scope="col" className="px-3 pb-2.5 font-semibold">
                Opponent
              </th>
              {showLineup && (
                <th scope="col" className="px-3 pb-2.5 font-semibold">
                  Line-up
                </th>
              )}
              <th scope="col" className="px-3 pb-2.5 font-semibold">
                Score
              </th>
              <th scope="col" className="px-3 pb-2.5 text-right font-semibold">
                Elo
              </th>
              <th scope="col" className="px-3 pb-2.5 text-right font-semibold">
                Status
              </th>
              {showActions && (
                // No visible label: the column holds one self-describing button and a
                // header would only eat width. The name still exists for a screen reader.
                <th scope="col" className="px-3 pb-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                showLineup={showLineup}
                showActions={showActions}
                onCancelSlot={onCancelSlot}
                // FT-4A — a member opens the sheet of EVERY row, a visitor only of a
                // completed one. Same rule as the guard of `GET /matches/{id}`, so no link
                // on this page can lead to a 403.
                canOpenSheet={isMember || match.status === 'completed'}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        {/* Says BOTH targets: the row hover highlights the opponent's cell too, so nothing on
            screen tells a reader that this one cell leads somewhere else. */}
        {isMember
          ? 'Every row opens its match sheet: line-ups, maps, Bo3 score and Elo change. The opponent’s name opens their team page.'
          : 'Only a completed match opens its match sheet — a running match is private to the two sides. The opponent’s name opens their team page.'}
      </p>
    </div>
  );
}
