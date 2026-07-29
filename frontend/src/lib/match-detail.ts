import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiFetch } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';
import { EM_DASH } from '@/lib/utils';

import type { paths } from '@/lib/api-types.gen';

/**
 * Everything that describes ONE match — `GET /matches/{id}` (B16).
 *
 * ⚠️ `formatMatchDate` and `formatEloDelta` live here since FT-4A (rule of the second use):
 * written by FT-2A inside `lib/team-detail.ts`, they format a MATCH, not a team, and the
 * match sheet is their second reader. Nothing was rewritten, only the file they live in —
 * `team-detail.ts` now reads them from this module, exactly as it already reads
 * `retryServerErrorsOnly` from `lib/ladders.ts`.
 */
type MatchDetailResponse =
  paths['/matches/{id}']['get']['responses'][200]['content']['application/json'];

export type MatchSheet = MatchDetailResponse['match'];
export type MatchSide = MatchDetailResponse['sides'][number];
export type MatchSidePlayer = MatchSide['players'][number];

// Mirrors the backend param schema (`z.uuid()` in routes/matches.ts): an id that cannot be
// a uuid can only ever come back as a 400, so the page renders its error state without
// spending a request — and without the red "Failed to load resource" line that request
// would leave in the console. Same shape as `isValidTeamId`/`isValidLadderId`, deliberately.
const matchIdSchema = z.uuid();

export function isValidMatchId(matchId: string) {
  return matchIdSchema.safeParse(matchId).success;
}

export function useMatch(matchId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['match', matchId],
    queryFn: () => apiFetch<MatchDetailResponse>(`/matches/${matchId}`),
    enabled,
    // A 403 ("not a participant") and a 404 are verdicts, not hiccups: retrying them three
    // times only delays the error screen and triples the browser's red lines.
    retry: retryServerErrorsOnly,
  });
}

// ---------------------------------------------------------------- sides

/**
 * Is this the 1v1 shape — the one where the PLAYER is the camp, so the sheet swaps the team
 * block for his avatar and pseudo?
 *
 * 🚨 Read from the LADDER'S FORMAT, never from `side.team === null` alone. `match_sides.team_id`
 * is `onDelete: 'set null'`, and `DELETE /teams/:id` only refuses a team engaged in a LIVE
 * match: a team whose matches are all `completed` CAN be dissolved, and its side then survives
 * with `team: null` on a 5v5 sheet that any authenticated account may read (B15 relaxed the
 * guard on a completed match). Reading that as "solo" renamed the camp after its first player,
 * linked to his profile, and DROPPED the five-player line-up — on the page whose whole point is
 * to show it. `format` is a closed enum in `openapi.yaml`, so the codegen hands us a literal
 * union: it is a contract, not a label.
 */
export function isSoloMatch(match: MatchSheet) {
  return match.ladder.format === '1v1';
}

/** Display name of a side: the team's name, the lone player's in 1v1, else a dissolved team. */
export function sideName(side: MatchSide, solo: boolean) {
  if (side.team) return side.team.name;
  // Not solo and no team = the team was dissolved after the match. Naming the camp after a
  // player would claim he played alone; he did not, and his team-mates are right below.
  if (!solo) return 'Disbanded team';

  const player = side.players[0];
  if (!player) return EM_DASH;
  return player.displayName ?? player.pseudo;
}

/** Team logo, or the lone player's avatar in 1v1. `undefined` when there is none. */
export function sideAvatarUrl(side: MatchSide, solo: boolean) {
  if (side.team) return side.team.logoUrl ?? undefined;
  return solo ? (side.players[0]?.avatarUrl ?? undefined) : undefined;
}

/** Two-letter fallback shown by `Avatar` when no image is available. */
export function sideInitials(side: MatchSide, solo: boolean) {
  return sideName(side, solo).slice(0, 2).toUpperCase();
}

/** Final Bo3 score of a side, or an em dash — `null` is legitimate on a completed match. */
export function formatSideScore(side: MatchSide) {
  return side.score === null ? EM_DASH : String(side.score);
}

/**
 * The side that has already reported a result, while the other has not. Only ever one on an
 * `awaiting_confirmation` match — the second submission closes the match or opens a dispute.
 */
export function submittedSide(sides: MatchSide[]) {
  return sides.find((side) => side.submittedAt !== null);
}

/**
 * Did an admin settle this match instead of the two sides agreeing?
 *
 * ⚠️ DERIVED, because `GET /matches/{id}` cannot say it outright: it drops `disputeId` as
 * soon as the match leaves `disputed`. But an arbitration leaves a signature — a winner IS
 * set while BOTH final scores stay `null`, since an admin rules on a winner, not on a score
 * (`completeMatchWithElo(…, null, null)` in `routes/disputes.ts`). A normal closure always
 * writes the two scores.
 */
export function settledByAdmin(match: MatchSheet, sides: MatchSide[]) {
  return (
    match.status === 'completed' &&
    match.winnerSideId !== null &&
    sides.length > 0 &&
    sides.every((side) => side.score === null)
  );
}

// ---------------------------------------------------------------- reporting (FT-4B)

/**
 * The two statuses `POST /matches/{id}/result` accepts. Anything else answers 409, so the
 * screen must not offer a button — a red console line is a project-rejection criterion.
 */
const REPORTABLE_STATUSES = ['in_progress', 'awaiting_confirmation'];

/** Why the viewer is NOT offered the result form. `null` = he may report right now. */
export type ReportBlocker =
  /** Neither captain of a side nor the player of a 1v1 camp: a bench player, a visitor. */
  | 'not_reporter'
  /** The cycle is not waiting for a result: open slot, cancelled, disputed, completed. */
  | 'wrong_status'
  /** §5.3 — kick-off has not passed. The API answers 400 « match not started yet ». */
  | 'not_started';

export type ReportEligibility = {
  /** The viewer's own side, when he is the one who reports for it. `null` otherwise. */
  mySide: MatchSide | null;
  /** The other camp — needed to mirror its submission and to name it on screen. */
  opponent: MatchSide | null;
  blocker: ReportBlocker | null;
};

/**
 * May this viewer report a result on this match, and if not, why not?
 *
 * Mirror of the three guards `POST /matches/{id}/result` applies, in the SAME order the
 * backend applies them (who → status → time), so the reason we show can never contradict
 * the reason the server would give.
 *
 * 🚨 THE POINT OF THIS FUNCTION IS THE NEGATIVE. Every combination it refuses must render
 * NO button at all: a button whose request is guaranteed to fail writes a red line in the
 * Chrome console, and a dirty console is a rejection criterion for the whole project — not
 * a rough edge.
 *
 * 🔑 « This camp has no team » does NOT mean 1v1. `match_sides.team_id` is `set null` and a
 * team whose matches are all completed CAN be dissolved, so a 5v5 camp survives with
 * `team: null`. The LADDER'S FORMAT is the only authority (`isSoloMatch`) — reading the
 * missing team as "solo" is what renamed a camp after its first player in FT-4A. The
 * consequence here is a deliberate, conservative divergence from the backend: on a teamless
 * side of a TEAM ladder the server would fall back on "any aligned player", we offer
 * nothing. That state only exists on matches that are already `completed`, which are not
 * reportable anyway.
 *
 * @param meId `useAuthStore(state => state.user?.id)` — `undefined` while the session boots.
 * @param nowMs a FRESH clock, not one frozen at mount: this decides whether an action is
 * offered, so a stale `now` would hide the form for as long as the tab stays open.
 */
export function canReportResult(
  match: MatchSheet,
  sides: MatchSide[],
  meId: string | undefined,
  nowMs: number,
): ReportEligibility {
  const solo = isSoloMatch(match);
  const mySide =
    (meId
      ? sides.find((side) =>
          // In 1v1 the PLAYER is the camp (the lineup holds exactly one name); from 2v2 up
          // only the captain speaks for his team. Same split as the backend.
          solo ? side.players.some((player) => player.id === meId) : side.team?.captainId === meId,
        )
      : undefined) ?? null;

  if (!mySide) return { mySide: null, opponent: null, blocker: 'not_reporter' };

  const opponent = sides.find((side) => side.id !== mySide.id) ?? null;
  // A slot nobody has accepted: there is no result to report, and its status says so too.
  if (!opponent) return { mySide, opponent: null, blocker: 'wrong_status' };

  if (!REPORTABLE_STATUSES.includes(match.status)) {
    return { mySide, opponent, blocker: 'wrong_status' };
  }

  // `msUntil` returns `null` on a missing/unparsable instant — treated as "not started",
  // the only safe reading: the server refuses to score a match with no `scheduled_at`.
  const kickoffIn = msUntil(match.scheduledAt, nowMs);
  if (kickoffIn === null || kickoffIn > 0) {
    return { mySide, opponent, blocker: 'not_started' };
  }

  return { mySide, opponent, blocker: null };
}

// ---------------------------------------------------------------- deadlines

/**
 * How long the other side has to confirm or contest before the job closes the match on its
 * own. Mirror of `CONFIRM_TIMEOUT_MS` in `backend/src/jobs/index.ts` — duplicated on purpose,
 * for the same reason as `MIN_LEAD_MINUTES` in `lib/team-detail.ts`: the screen cannot
 * announce a deadline it does not know. The server stays the authority.
 */
export const CONFIRMATION_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Milliseconds from `nowMs` to an ISO instant — negative once it is past, `null` when the
 * instant is absent or unparsable.
 *
 * ⚠️ `scheduledAt`/`submittedAt`/`completedAt` are ISO **strings** that can be `null`, never
 * `Date` objects — and `new Date(null)` silently yields 1970 instead of failing, which is
 * exactly what this guard exists for.
 */
export function msUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;

  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;

  return at - nowMs;
}

/** Deadline of the pending confirmation: submission + 24 h. `null` without a submission. */
export function confirmationMsLeft(side: MatchSide | undefined, nowMs: number) {
  if (!side?.submittedAt) return null;

  const submitted = new Date(side.submittedAt).getTime();
  if (Number.isNaN(submitted)) return null;

  return submitted + CONFIRMATION_WINDOW_HOURS * HOUR_MS - nowMs;
}

/**
 * A rough, human duration: "3 days", "5 h 20 min", "12 min". Deliberately coarse — this
 * sheet answers "roughly when", and a seconds-accurate countdown would need a timer whose
 * only product is a repaint per second.
 */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 60_000));
  if (total < 1) return 'less than a minute';

  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const minutes = total % 60;

  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

// ---------------------------------------------------------------- formatting

// Built once at module scope: an Intl formatter is expensive to create and these options
// never change.
const shortDateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const longDateFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * `scheduledAt` / `completedAt` are ISO **strings** that can be `null` — and
 * `new Date(null)` silently yields 1970 instead of failing, so the null check is the
 * whole point of this helper.
 */
export function formatMatchDate(iso: string | null, style: 'short' | 'long' = 'short') {
  if (!iso) return EM_DASH;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;

  return (style === 'long' ? longDateFormat : shortDateFormat).format(date);
}

/** Signed Elo delta with a real minus sign (U+2212), never a hyphen. */
export function formatEloDelta(eloDelta: number | null) {
  if (eloDelta === null) return EM_DASH;
  if (eloDelta < 0) return `−${Math.abs(eloDelta)}`;
  return `+${eloDelta}`;
}
