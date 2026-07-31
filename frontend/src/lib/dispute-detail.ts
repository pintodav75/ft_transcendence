import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiFetch } from '@/lib/api';
import { isSoloMatch, sideName } from '@/lib/match-detail';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of `/disputes/$disputeId` — the dispute file: what each camp claimed, the thread of
 * evidence, and the verdict once an admin has ruled.
 *
 * 🚨 A DISPUTE USED TO BE A DEAD END. FT-4B lets two camps disagree, and from that moment NO
 * screen existed — no thread, no way to file a screenshot, no way to follow it. Yet the 24 h job
 * (`backend/src/jobs/index.ts`) CANCELS a dispute nobody settles, so whoever cannot file his
 * evidence loses the match by default. That is what this page exists for.
 *
 * 🔑 ONE REQUEST FOR THE WHOLE PAGE, and it deliberately does NOT touch `GET /matches/{id}`. Two
 * reasons, both load-bearing: an ADMIN reads this file without being a participant, and that
 * route would answer him **403** on a `disputed` match (a red console line, i.e. a
 * project-rejection criterion); and `match.ladder.format` is the ONLY authority for "this is
 * 1v1" — see `isSoloMatch`. [F-ADMIN] reuses this page as is.
 *
 * 🚨 THIS MODULE DECIDES NOTHING ABOUT ARBITRATION. Ruling on a dispute is admin-only and lives
 * in [F-ADMIN]; everything here either DISPLAYS the file or answers "may I file evidence?"
 * (`canSubmitEvidence`). Keeping the two apart is what lets [F-ADMIN] add its three outcomes to
 * this screen without unpicking it.
 */
type DisputeResponse = paths['/disputes/{id}']['get']['responses'][200]['content']['application/json'];

export type DisputeFile = DisputeResponse;
export type Dispute = DisputeResponse['dispute'];
export type DisputeSide = DisputeResponse['sides'][number];
export type DisputeEvidence = DisputeResponse['evidence'][number];

// Mirrors the backend param schema (`z.uuid()` in routes/disputes.ts): an id that cannot be a
// uuid can only ever come back as a 400, so the page renders its error state without spending a
// request — and without the red "Failed to load resource" line that request would leave in the
// console. Same shape as `isValidMatchId`, deliberately.
const disputeIdSchema = z.uuid();

export function isValidDisputeId(disputeId: string) {
  return disputeIdSchema.safeParse(disputeId).success;
}

export function disputeKey(disputeId: string) {
  return ['dispute', disputeId] as const;
}

/**
 * The dispute file itself.
 *
 * 🚨 `staleTime: 0` **AND** `gcTime: 0`, AND THAT IS THE GUARD, NOT A TUNING KNOB. Every
 * `evidenceUrl` in this payload is a **presigned URL valid for ~5 minutes** (the evidence bucket
 * is private). React Query paints the CACHE first and revalidates after, so with any cache
 * retention at all, coming back to this page six minutes later would mount every `<img>` on an
 * EXPIRED url — Chrome logs the 403 before the refetch can answer, and a dirty console is a
 * project-rejection criterion. An `onError` on the image cannot help: the browser logs the
 * failed request whatever the handler does.
 *
 * With `gcTime: 0` the entry is dropped as soon as the last observer unmounts, so every visit
 * starts from a loading state and NO render can ever carry a stale signed url. The price is a
 * loading flash on each visit, which is exactly right for a screen whose every url is temporary.
 *
 * ⚠️ DO NOT "OPTIMISE" THIS BACK. Adding a `staleTime` here — or letting the default `gcTime`
 * stand — reopens that hole silently: it only shows up as a red console line, on a page nobody
 * revisits within five minutes while testing.
 */
export function useDispute(disputeId: string, enabled: boolean) {
  return useQuery({
    queryKey: disputeKey(disputeId),
    queryFn: () => apiFetch<DisputeResponse>(`/disputes/${encodeURIComponent(disputeId)}`),
    enabled,
    staleTime: 0,
    gcTime: 0,
    // A 403 ("not a participant") and a 404 are verdicts, not hiccups: retrying them three
    // times only delays the error screen and triples the browser's red lines.
    retry: retryServerErrorsOnly,
  });
}

// ---------------------------------------------------------------- the 24 h clock

/**
 * How long a dispute nobody settles survives before the job cancels the match outright.
 *
 * Mirror of the cutoff used by `timeoutDisputes()` in `backend/src/jobs/index.ts`, duplicated on
 * purpose for the same reason as `CONFIRMATION_WINDOW_HOURS` and `MIN_LEAD_MINUTES`: the screen
 * cannot announce a deadline it does not know, and the server stays the authority.
 *
 * ⚠️ NOT `CONFIRMATION_WINDOW_HOURS`, EVEN THOUGH BOTH ARE 24 h TODAY. The backend currently
 * spends a single `CONFIRM_TIMEOUT_MS` on both jobs, but they are two different mechanisms with
 * two different clock starts — one runs from a SCORE SUBMISSION, this one from the OPENING of the
 * dispute — and they cancel opposite things (job B applies the submitted score, job C cancels the
 * match). Importing the other constant here would make a future decoupling on the server follow
 * only one of them, in silence.
 */
export const DISPUTE_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Milliseconds left before the job cancels a dispute OPENED at `createdAt` — negative once the
 * window is past, `null` on an unparsable instant.
 *
 * 🔑 EXTRACTED BY [F-ADMIN] AT ITS SECOND READER, and the split is the whole point: the
 * arbitration queue (`GET /disputes`) serves rows that carry `createdAt` but **no `status`** —
 * they are `open` by construction, the route lists nothing else. It needs the arithmetic without
 * the status guard, and a queue counting down differently from the file it links to would be
 * worse than no countdown at all. `disputeMsLeft` keeps its signature and its guard; nothing on
 * the dispute file changed.
 */
export function disputeWindowMsLeft(createdAt: string, nowMs: number): number | null {
  const opened = new Date(createdAt).getTime();
  if (Number.isNaN(opened)) return null;

  return opened + DISPUTE_WINDOW_HOURS * HOUR_MS - nowMs;
}

/**
 * Milliseconds left before the job cancels this dispute — negative once it is past, `null` on a
 * dispute that is already settled (there is no countdown on a closed file) or on an unparsable
 * instant.
 */
export function disputeMsLeft(dispute: Dispute, nowMs: number): number | null {
  if (dispute.status !== 'open') return null;

  return disputeWindowMsLeft(dispute.createdAt, nowMs);
}

// ---------------------------------------------------------------- reading the file

/** The camp an evidence post (or a declared winner) belongs to. `undefined` if it is unknown. */
export function sideById(sides: DisputeSide[], sideId: string | null) {
  if (!sideId) return undefined;
  return sides.find((side) => side.id === sideId);
}

/**
 * What THIS camp declared: the name of the side it says won, or `null` when it never reported.
 *
 * ⚠️ `submittedWinnerSideId` points at a SIDE, never at a team or a player. Resolving it through
 * the sides list is the only way to turn it into something a human reads — and a camp can name
 * ITSELF or the other one, which is precisely the disagreement this page exists to show.
 */
export function claimedWinnerName(
  side: DisputeSide,
  sides: DisputeSide[],
  solo: boolean,
): string | null {
  const winner = sideById(sides, side.submittedWinnerSideId);
  return winner ? sideName(winner, solo) : null;
}

/**
 * Do the two camps really contradict each other?
 *
 * Almost always true — a dispute is opened precisely when they disagree — but not necessarily:
 * B6 also opens one when both name the SAME winner with different scores (2–0 against 2–1), and
 * this payload does not carry the scores. Saying "they named different winners" when they did
 * not would be a small lie on the one screen whose subject is the disagreement.
 */
export function claimsContradict(sides: DisputeSide[]) {
  const claims = sides.map((side) => side.submittedWinnerSideId);
  if (claims.length < 2) return false;
  if (claims.some((claim) => claim === null)) return false;

  return claims[0] !== claims[1];
}

/**
 * Was this file closed by the 24 h JOB rather than by a human arbiter?
 *
 * 🚨 THIS IS THE COMMON CASE, NOT THE EDGE CASE, AND THE SCREEN USED TO LIE ABOUT IT. [F-ADMIN]
 * does not exist yet, so `POST /disputes/{id}/resolve` is reachable from NO screen: the timeout is
 * today the ONLY path to `resolved`, and the demo dispute takes it on its own 24 h after a seed.
 * The job writes the very same columns an admin would (`status`, `resolution`, `resolvedAt`) —
 * plus a `resolutionNotes` that is an INTERNAL LOG LINE in French, not an arbiter's prose. Serving
 * it under "Admin's note" was the defect this predicate exists to close.
 *
 * 🔑 WHY THE TEST IS `resolution === 'cancelled'` AND NOT JUST `settledBy !== 'admin'`. The job
 * only ever writes `cancelled` (`timeoutDisputes()` in `backend/src/jobs/index.ts`), so a ruled
 * WINNER always came from a human — even when `settledBy` says `timeout`, which it does once that
 * admin deletes his account (`resolved_by_user_id` is `set null`). Reading that as a job would
 * throw away a genuine note. Both conditions together are exact.
 *
 * ⚠️ ONE LOSSY DIRECTION, AND IT IS THE SAFE ONE: an admin who rules `cancelled` and later deletes
 * his account reads as a timeout here, so his note is hidden. Losing a real note beats presenting
 * a log line as an arbiter's reasoning.
 */
export function settledByTimeout(dispute: Dispute) {
  return (
    dispute.status === 'resolved' &&
    dispute.resolution === 'cancelled' &&
    dispute.settledBy !== 'admin'
  );
}

/** Plain-language verdict of a settled dispute. `null` while it is still open. */
export function resolutionVerdict(dispute: Dispute, sides: DisputeSide[], solo: boolean) {
  switch (dispute.resolution) {
    case 'side_0_wins':
    case 'side_1_wins': {
      const index = dispute.resolution === 'side_0_wins' ? 0 : 1;
      const winner = sides.find((side) => side.sideIndex === index);
      // The enum is indexed on `sideIndex`, which the payload sorts on — but naming the camp is
      // the whole job here, so a missing side degrades to the honest generic rather than to
      // "side_0_wins", which means nothing to a reader.
      return winner
        ? `${sideName(winner, solo)} was ruled the winner. Elo has been applied to both camps.`
        : 'One camp was ruled the winner. Elo has been applied to both camps.';
    }
    case 'cancelled':
      // ⚠️ TWO SENTENCES FOR ONE ENUM VALUE, and they must coexist: an admin can legitimately
      // choose `cancelled` when he cannot separate the camps, AND the job writes exactly the same
      // value when nobody turns up. Only `settledBy` tells them apart.
      return settledByTimeout(dispute)
        ? 'Nobody settled this dispute within 24 hours, so the match was cancelled automatically. It counts for nothing, and no Elo was applied to either side.'
        : 'The admin could not separate the two camps, so the match was cancelled. No Elo was applied to either side.';
    case null:
      return null;
  }
}

// ---------------------------------------------------------------- attachments

/**
 * What a presigned evidence url can be rendered as.
 *
 * 🚨 THE RULE IS ASYMMETRIC ON PURPOSE, and the reason is worth stating precisely because the
 * obvious version of it is WRONG. An `<img>` pointed at a PDF does NOT write a console line —
 * MinIO answers 200, the request succeeds, and only the DECODE fails, which Chrome reports
 * silently through the element's `error` event (verified with a deliberately broken build during
 * [F-DISPUTE]). What it does cost is real all the same: a broken-image glyph on the one screen
 * whose subject is evidence, and a pointless download of the whole file. Rendering a link where a
 * thumbnail would have done costs a thumbnail. Asymmetric costs, asymmetric rule — `image` is
 * granted ONLY on a known image extension, everything else falls back to a plain link.
 *
 * ⚠️ The genuine console risk of this screen is elsewhere: a PRESIGNED url that has expired
 * answers 403, and THAT is a red line. It is closed by `useDispute`'s `gcTime: 0`, not here.
 *
 * 🔑 WHY AN EXTENSION IS TRUSTWORTHY HERE, AND IT IS NOT A GUESS: the API never sends a MIME
 * type, but the object key is built by the SERVER as `${randomUUID()}.${EVIDENCE_MIME[mime]}`
 * from a CLOSED map (`backend/src/routes/users.ts`) after it has validated the upload — the user
 * never chooses it. `presignEvidenceUrl` then hands back that key inside a `/media/...` path.
 * ⚠️ Should the backend ever start serving a content type, read THAT instead and delete this.
 */
export type Attachment = { kind: 'image' | 'file'; href: string; label: string };

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/**
 * Turns an `evidenceUrl` into something renderable, or `null` when it must not be rendered at
 * all.
 *
 * 🚨 THE PROTOCOL IS CHECKED, NOT ASSUMED. `new URL(value, origin)` happily parses
 * `javascript:…`, `data:…` and `file:…`, and any of them in an `href` is an XSS vector — this
 * repo has already been bitten there (`logoUrl`, the proxy targets of `vite.config.ts`). A
 * relative `/media/...` path resolves to the page's own https origin, which is the only shape
 * the contract describes; anything else renders NO link rather than a suspicious one.
 */
export function attachmentOf(evidenceUrl: string): Attachment | null {
  let url: URL;
  try {
    url = new URL(evidenceUrl, window.location.origin);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  // `pathname` only — the presigned query string carries `X-Amz-…` parameters that would
  // otherwise be read as part of the file name.
  // ⚠️ `includes('.')` FIRST: `'/media/evidence/abc'.split('.').pop()` returns the WHOLE path, so
  // an extensionless key would have been labelled "(/MEDIA/EVIDENCE/ABC)". Unreachable with the
  // keys the server writes, but a function should not depend on that to be honest.
  const pathname = url.pathname;
  const extension = pathname.includes('.')
    ? (pathname.split('.').pop()?.toLowerCase() ?? '')
    : '';
  const isImage = IMAGE_EXTENSIONS.has(extension);

  return {
    kind: isImage ? 'image' : 'file',
    href: url.toString(),
    // Names the FORMAT, not the file: the stored name is a uuid, which tells a reader nothing.
    label: extension ? extension.toUpperCase() : 'FILE',
  };
}

// ---------------------------------------------------------------- filing evidence

/**
 * The client echo of what `POST /disputes/{id}/evidence` accepts.
 *
 * ⚠️ SEPARATE FROM `ImagePicker`'S OWN LIST, exactly as `EVIDENCE_MIME` is separate from
 * `IMAGE_MIME` on the server: an avatar is an image, a piece of evidence may perfectly well be a
 * PDF, and a 5 MB cap instead of 2 MB. Merging the two would make one of the two screens lie.
 * The server remains the real rampart — this is what makes a bad pick fail instantly and
 * readably instead of after a round trip that ends in 400/413.
 */
export const EVIDENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
export const EVIDENCE_ACCEPT_ATTRIBUTE = EVIDENCE_MIME_TYPES.join(',');
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_MAX_MB = EVIDENCE_MAX_BYTES / (1024 * 1024);

/** Why this pick is refused, in a sentence — `null` when the file is acceptable. */
export function evidenceFileError(file: File): string | null {
  if (!EVIDENCE_MIME_TYPES.includes(file.type)) {
    return 'Attach a PNG, JPEG or WebP image, or a PDF.';
  }
  if (file.size > EVIDENCE_MAX_BYTES) {
    return `This file is too large — max ${EVIDENCE_MAX_MB} MB.`;
  }
  return null;
}

/** Human file size for the picked attachment, e.g. `842 kB` / `1.4 MB`. */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why the viewer is NOT offered the evidence form. `null` = he may file right now. */
export type EvidenceBlocker =
  /** The dispute has been settled (or auto-cancelled): the file is history, read-only. */
  | 'settled'
  /** Neither captain of a camp nor the player of a 1v1 camp: a bench player, an admin, a visitor. */
  | 'not_a_party'
  /** The 24 h are up. The job has not run yet, but the API will answer 409 the moment it does. */
  | 'window_closed';

export type EvidenceEligibility = {
  /** The viewer's own camp, when he is the one who speaks for it. `null` otherwise. */
  mySide: DisputeSide | null;
  blocker: EvidenceBlocker | null;
};

/**
 * May this viewer file a piece of evidence, and if not, why not?
 *
 * Mirror of the guards `POST /disputes/{id}/evidence` applies: I am the CAPTAIN of one of the two
 * camps (2v2+) or the PLAYER of one of them (1v1), and the dispute is still `open`.
 *
 * 🚨 THE POINT OF THIS FUNCTION IS THE NEGATIVE — same discipline as `canReportResult`. A bench
 * player, a team-mate who is not captain, an admin who is not a party: all of them READ the file
 * and get no control whatsoever. A button whose request the API is certain to refuse writes a red
 * line in the Chrome console, and that is a rejection criterion for the whole project.
 *
 * 🔑 THE CAMP IS DECIDED BY THE LADDER'S FORMAT, NEVER BY `side.team === null`. The server does
 * the opposite — it branches on `side.teamId` — so on a teamless side of a TEAM ladder it would
 * fall back on "any aligned player" where we offer nothing. ⚠️ THAT DIVERGENCE IS UNREACHABLE,
 * and it is worth stating rather than merely calling conservative: `DELETE /teams/:id` refuses a
 * team engaged in a match and `disputed` is one of the engaging statuses, so while a dispute is
 * OPEN a camp of a 2v2+ ladder always still has its team. Once it is settled this function
 * returns `settled` anyway.
 *
 * @param meId `useAuthStore(state => state.user?.id)` — `undefined` while the session boots.
 * @param nowMs a FRESH clock, not one frozen at mount: see the page, which pairs a ticking clock
 * with `dataUpdatedAt` as a floor.
 */
export function canSubmitEvidence(
  file: DisputeFile,
  meId: string | undefined,
  nowMs: number,
): EvidenceEligibility {
  const solo = isSoloMatch(file.match);
  const mySide =
    (meId
      ? file.sides.find((side) =>
          // In 1v1 the PLAYER is the camp (the line-up holds exactly one name); from 2v2 up only
          // the captain speaks for his team. Same split as the backend.
          solo ? side.players.some((player) => player.id === meId) : side.team?.captainId === meId,
        )
      : undefined) ?? null;

  // Checked before the party guard, unlike the server — which hides the state from a stranger on
  // purpose (no open/resolved oracle). We are past that: the payload only reaches someone the
  // read guard already let in, and "this file is closed" is the dominant fact of the screen.
  if (file.dispute.status !== 'open') return { mySide, blocker: 'settled' };

  if (!mySide) return { mySide: null, blocker: 'not_a_party' };

  // ⚠️ THE [F-MM] RACE, APPLIED HERE. The job cancels a dispute 24 h after it was opened; a tab
  // left open across that instant holds a payload that still says `open`, so the form would stay
  // on offer and the click would answer 409 — a red line in the console. The ticking clock is
  // what closes it; `status` alone cannot.
  const left = disputeMsLeft(file.dispute, nowMs);
  if (left !== null && left <= 0) return { mySide, blocker: 'window_closed' };

  return { mySide, blocker: null };
}
