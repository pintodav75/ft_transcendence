import { formatMatchDate } from '@/lib/match-detail';

import type { AppNotification } from '@/lib/realtime-schema';

/**
 * WHERE a notification leads, as a discriminated union rather than a path.
 *
 * A UNION, NOT A COMPUTED `to`. TanStack ties `params` to the literal route path, so a
 * variable `to` is not type-checkable — and losing that check is exactly how a route rename
 * ends up producing a link to nowhere at runtime. `NotificationsSlot` renders one literal
 * `<Link>` per kind, the same way `MatchLineLink` does.
 */
export type NotificationLink =
  | { kind: 'match'; matchId: string }
  | { kind: 'dispute'; disputeId: string }
  | { kind: 'ladder'; ladderId: string }
  | { kind: 'teams' };

export type NotificationDisplay = {
  /** One plain English sentence. NEVER an id, a status enum or a raw payload. */
  text: string;
  /** `null` when nothing can be linked SAFELY — see the table in `describeNotification`. */
  link: NotificationLink | null;
};

const LINK_LABELS: Record<NotificationLink['kind'], string> = {
  match: 'View the match',
  dispute: 'View the dispute',
  ladder: 'View the standings',
  teams: 'View my teams',
};

/** The visible "where this leads" line, and the tail of the link's accessible name. */
export function notificationLinkLabel(link: NotificationLink) {
  return LINK_LABELS[link.kind];
}

/** Quoted, because a team name is user-provided text dropped into a sentence. */
function quoted(name: string) {
  return `“${name}”`;
}

/**
 * What one notification says, and where it leads.
 *
 * a notification is a past fact and its target may be gone. a link that 404s or 403s writes a
 * red console line, so only link a target that is provably still there AND still readable by me:
 *   - /matches/$matchId — a match row is never deleted (disbanding only nulls the side's
 *     team_id), and these go to people GET /matches/:id lets in.
 *   - /disputes/$disputeId — cascades from its match, so never deleted.
 *   - /ladders/$ladderId — seeded config, restrict on delete, readable by anyone signed in.
 *     that's why every team payload carries a ladderId: it outlives the team it talks about.
 *   - /teams — static route, can't 404, and it's where invitations are answered.
 *
 * NOT linked:
 *   - /teams/$teamId — disbanding DELETES the row, so it would eventually 404. team
 *     notifications lead to the ladder instead.
 *   - /players/$pseudo — the payload carries a pseudo snapshot, and an account can be renamed
 *     or deleted.
 *   - match_cancelled_member_left and dispute_needs_admin — both 403s, not 404s: a right held
 *     when it was sent and lost by the time it's opened.
 */
export function describeNotification(notification: AppNotification): NotificationDisplay {
  switch (notification.type) {
    // ---------------------------------------------------------------- match life cycle
    case 'match_accepted':
      return {
        text: `Your match is on — kick-off ${formatMatchDate(notification.data.scheduledAt, 'short')}.`,
        link: { kind: 'match', matchId: notification.data.matchId },
      };

    case 'result_submitted':
      return {
        text: 'A result was submitted on your match — confirm it or open a dispute.',
        link: { kind: 'match', matchId: notification.data.matchId },
      };

    case 'result_confirmed':
      // `winnerSideId` names a row of `match_sides`, which says nothing to a reader and is
      // exactly the kind of raw id a notification must not show. The match sheet says who won.
      return {
        text: 'Your match result is confirmed.',
        link: { kind: 'match', matchId: notification.data.matchId },
      };

    case 'match_ghost_cancelled':
      return {
        text: 'No result was submitted within 24 hours — your match was cancelled.',
        link: { kind: 'match', matchId: notification.data.matchId },
      };

    case 'match_cancelled_member_left': {
      const { playerPseudo, teamName, scheduledAt } = notification.data;
      // `scheduledAt` is nullable HERE (and nowhere else), so the time is part of the sentence
      // only when there is one — never an em dash standing in for a missing hour.
      const when = scheduledAt ? ` (${formatMatchDate(scheduledAt, 'short')})` : '';

      // THE LADDER, NOT THE MATCH, and this one is the exception among match notifications.
      return {
        text: `@${playerPseudo} left ${quoted(teamName)} — your match${when} was cancelled.`,
        link: { kind: 'ladder', ladderId: notification.data.ladderId },
      };
    }

    // ---------------------------------------------------------------------- disputes
    case 'dispute_opened':
      return {
        text: 'A dispute was opened on your match.',
        link: { kind: 'dispute', disputeId: notification.data.disputeId },
      };

    case 'dispute_resolved':
      return {
        text:
          notification.data.resolution === 'cancelled'
            ? 'Your dispute was settled — the match was cancelled.'
            : // Naming the winning SIDE would mean naming a row id, or guessing which side is mine. The dispute page states the ruling in full.
              'Your dispute was settled — an admin decided the winner.',
        link: { kind: 'dispute', disputeId: notification.data.disputeId },
      };

    case 'dispute_auto_cancelled':
      return {
        text: 'The dispute went 24 hours without a ruling — your match was cancelled.',
        link: { kind: 'dispute', disputeId: notification.data.disputeId },
      };

    case 'dispute_needs_admin':
      // NOT LINKED, and it is the only dispute type that is not.
      return { text: 'A dispute is waiting for an admin ruling.', link: null };

    // ------------------------------------------------------------------------ friends No link
    // on either: the only page about a person is `/players/$pseudo`, and the pseudo here is a
    // snapshot of an account that may since have been renamed or deleted.
    case 'friend_request_received':
      return { text: `@${notification.data.fromPseudo} sent you a friend request.`, link: null };

    case 'friend_request_accepted':
      return { text: `@${notification.data.byPseudo} accepted your friend request.`, link: null };

    // -------------------------------------------------------------------------- teams
    case 'team_member_added':
      // NOBODY EMITS THIS ANY MORE — adding a player went through invitations.
      return {
        text: `@${notification.data.byPseudo} added you to ${quoted(notification.data.teamName)}.`,
        link: { kind: 'ladder', ladderId: notification.data.ladderId },
      };

    case 'team_member_removed':
      return {
        text: `@${notification.data.byPseudo} removed you from ${quoted(notification.data.teamName)}.`,
        link: { kind: 'ladder', ladderId: notification.data.ladderId },
      };

    case 'team_disbanded':
      return {
        text: `@${notification.data.byPseudo} disbanded ${quoted(notification.data.teamName)}.`,
        link: { kind: 'ladder', ladderId: notification.data.ladderId },
      };

    case 'team_invitation_received':
      return {
        text: `@${notification.data.byPseudo} invited you to join ${quoted(notification.data.teamName)}.`,
        link: { kind: 'teams' },
      };

    case 'team_invitation_accepted':
      return {
        text: `@${notification.data.byPseudo} accepted your invitation to ${quoted(notification.data.teamName)}.`,
        link: { kind: 'teams' },
      };

    case 'team_invitation_declined':
      return {
        text: `@${notification.data.byPseudo} declined your invitation to ${quoted(notification.data.teamName)}.`,
        link: { kind: 'teams' },
      };

    // -------------------------------------------------------------------- safety net
    /**
     * A type this build has never heard of, or a known type whose payload no longer matches the
     * contract (`notificationSchema` sends both here).
     */
    case 'unsupported':
    default:
      return { text: 'You have a new notification.', link: null };
  }
}
