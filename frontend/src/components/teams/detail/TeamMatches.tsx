import { MatchHistoryTable } from '@/components/matches/MatchHistoryTable';
import { openDisputeCount } from '@/lib/match-history';
import { formatLineup } from '@/lib/team-detail';

import type { Ref } from 'react';
import type { MatchHistoryRow } from '@/components/matches/MatchHistoryTable';
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

/**
 * Match history tab of a TEAM page — the adapter between `GET /teams/{id}/matches` and the
 * shared `MatchHistoryTable` (moved out of this file by [F-SOLO], rule of the second use).
 *
 * Everything team-specific lives here and nowhere else: the opponent is always a team, the
 * line-up column is real, the prose talks about a team, and the dispute notice keeps the
 * `role="status"` it has carried since FT-2A.
 */
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

  const rows: MatchHistoryRow<TeamMatch>[] = list.map((match) => ({
    match,
    // On a team ladder the opponent is ALWAYS a team — `GET /teams/{id}/matches` carries no
    // discriminant, and `null` here only ever means "open slot" or "dissolved team".
    opponent: match.opponent
      ? { kind: 'team', id: match.opponent.id, name: match.opponent.name }
      : null,
    // ABSENT (not null) for a non-member: `undefined` is what drops the whole column.
    lineup: match.lineup ? formatLineup(match.lineup.self) : undefined,
    // FT-4A — a member opens the sheet of EVERY row, a visitor only of a completed one. Same
    // rule as the guard of `GET /matches/{id}`, so no link on this page can lead to a 403.
    canOpenSheet: isMember || match.status === 'completed',
  }));

  return (
    <MatchHistoryTable
      rows={rows}
      // Hidden from a non-member, who has no business being told: same rendering as the
      // `isMember && disputes > 0` guard this replaces.
      disputes={isMember ? openDisputeCount(list) : 0}
      disputeNoticeRole="status"
      emptyMessage={
        isMember
          ? 'No match yet — this team has not played or opened a slot.'
          : 'No public match yet: only matches an opponent has accepted are listed here.'
      }
      footnote={
        // Says BOTH targets: the row hover highlights the opponent's cell too, so nothing on
        // screen tells a reader that this one cell leads somewhere else.
        isMember
          ? 'Every row opens its match sheet: line-ups, maps, Bo3 score and Elo change. The opponent’s name opens their team page.'
          : 'Only a completed match opens its match sheet — a running match is private to the two sides. The opponent’s name opens their team page.'
      }
      onCancelSlot={onCancelSlot}
      historyRef={historyRef}
    />
  );
}
