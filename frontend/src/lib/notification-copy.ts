import { formatMatchDate } from '@/lib/match-detail';

import type { AppNotification } from '@/lib/realtime-schema';

/**
 * WHERE a notification leads, as a discriminated union rather than a path.
 *
 * 🔑 A UNION, NOT A COMPUTED `to`. TanStack ties `params` to the literal route path, so a
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
 * WHAT ONE NOTIFICATION SAYS, AND WHERE IT LEADS.
 *
 * 🚨 A NOTIFICATION IS A PAST FACT, AND ITS TARGET MAY BE GONE. A link that answers 404 (or
 * 403) writes a red line in the console, which is a rejection criterion for the whole project
 * — so a target is linked only when it is provably still there AND still readable BY ME:
 *
 *  ✅ `/matches/$matchId`   — a match row is NEVER deleted (disbanding a team only sets its
 *     side's `team_id` to null), and these notifications go to an aligned player or to the
 *     engaged team's captain, which is exactly who `GET /matches/:id` lets in. ⚠️ ONE match
 *     type is excluded — see `match_cancelled_member_left` below.
 *  ✅ `/disputes/$disputeId` — a dispute cascades from its match, which is never deleted, and
 *     `GET /disputes/:id` admits the aligned players and the engaged teams' members. ⚠️ It
 *     ALSO admits admins, but that is a right checked at every call, so the admin-only type is
 *     not linked — see `dispute_needs_admin` below.
 *  ✅ `/ladders/$ladderId`  — ladders are seeded configuration, `restrict` on delete, and
 *     readable by anyone signed in. That is precisely why every team payload carries a
 *     `ladderId`: it survives the team it talks about (see `notification-schemas.ts`).
 *  ✅ `/teams`             — a static route, so it cannot 404, and it is where invitations are
 *     actually answered.
 *
 * ❌ NOT LINKED — `/teams/$teamId`: disbanding a team DELETES the row (`routes/teams.ts`), so
 *    every team notification would eventually point at a 404. Team notifications lead to the
 *    ladder instead, which is where the team was competing.
 * 🔑 THE TWO EXCEPTIONS ARE BOTH 403s, NOT 404s — a right that was held when the notification
 *    was sent and is not held any more when it is opened. A cancelled match lets its captain
 *    disband the team that gave them access to it (`match_cancelled_member_left` → the ladder),
 *    and an admin can be demoted (`dispute_needs_admin` → no link at all).
 *
 * ❌ NOT LINKED — `/players/$pseudo`: the payload carries a pseudo SNAPSHOT, and an account can
 *    be renamed or deleted (`DELETE /users/me` really deletes the row). Two independent ways
 *    of producing a 404 from a sentence whose only job was to name somebody.
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
      // ⚠️ `scheduledAt` is nullable HERE (and nowhere else), so the time is part of the
      // sentence only when there is one — never an em dash standing in for a missing hour.
      const when = scheduledAt ? ` (${formatMatchDate(scheduledAt, 'short')})` : '';

      // ⚠️ THE LADDER, NOT THE MATCH, and this one is the exception among match notifications.
      // Its recipients include the CAPTAIN, who may be out of the line-up — and once the match
      // is cancelled they may legally disband the team, which is exactly what takes their read
      // access to `GET /matches/:id` away. The ladder is readable by anyone signed in, and the
      // payload carries `ladderId` for precisely this reason.
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
            : // Naming the winning SIDE would mean naming a row id, or guessing which side is
              // mine. The dispute page states the ruling in full.
              'Your dispute was settled — an admin decided the winner.',
        link: { kind: 'dispute', disputeId: notification.data.disputeId },
      };

    case 'dispute_auto_cancelled':
      return {
        text: 'The dispute went 24 hours without a ruling — your match was cancelled.',
        link: { kind: 'dispute', disputeId: notification.data.disputeId },
      };

    case 'dispute_needs_admin':
      // ❌ NOT LINKED, and it is the only dispute type that is not. `GET /disputes/:id` checks
      // the admin flag AT EVERY CALL, never at the moment the notification was sent — and this
      // team clears that flag in the database before each console-audit campaign, so an admin
      // reading yesterday's alert after being demoted is a path our own environment takes. The
      // sentence still says what happened; `/admin/disputes` is where it is acted on.
      return { text: 'A dispute is waiting for an admin ruling.', link: null };

    // ------------------------------------------------------------------------ friends
    // No link on either: the only page about a person is `/players/$pseudo`, and the pseudo
    // here is a snapshot of an account that may since have been renamed or deleted. The
    // request itself is answered in the rail's own "Friends" tab, one click away.
    case 'friend_request_received':
      return { text: `@${notification.data.fromPseudo} sent you a friend request.`, link: null };

    case 'friend_request_accepted':
      return { text: `@${notification.data.byPseudo} accepted your friend request.`, link: null };

    // -------------------------------------------------------------------------- teams
    case 'team_member_added':
      // ⚠️ NOBODY EMITS THIS ANY MORE — adding a player went through invitations with [B-INV].
      // The value still exists in the database and old rows still reference it, so it gets a
      // rendering like the other sixteen. It is not an exception, it is history.
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
     * A type this build has never heard of, or a known type whose payload no longer matches
     * the contract (`notificationSchema` sends both here). There is nothing truthful to say
     * about it and nothing safe to link to — but it is still a real, dated notification of
     * mine, so it is listed, it can be marked read, and it counts in the badge.
     */
    case 'unsupported':
    default:
      return { text: 'You have a new notification.', link: null };
  }
}
