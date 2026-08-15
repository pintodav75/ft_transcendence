import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { apiFetch } from '@/lib/api';
import { isSoloMatch, sideName } from '@/lib/match-detail';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { paths } from '@/lib/api-types.gen';

/**
 * Read side of /disputes/$disputeId: what each camp claimed, the evidence thread, and the
 * verdict once an admin has ruled.
 *
 * one request for the whole page, and deliberately NOT GET /matches/{id}: an admin reads this
 * file without being a participant and that route would 403 him on a disputed match.
 * match.ladder.format is the only authority for "this is 1v1" (see isSoloMatch).
 * nothing here decides arbitration — this either displays the file or answers "may I file
 * evidence?" (canSubmitEvidence). ruling lives in the arbitration screen.
 */
type DisputeResponse = paths['/disputes/{id}']['get']['responses'][200]['content']['application/json'];

export type DisputeFile = DisputeResponse;
export type Dispute = DisputeResponse['dispute'];
export type DisputeSide = DisputeResponse['sides'][number];
export type DisputeEvidence = DisputeResponse['evidence'][number];

// Mirrors the backend param schema (`z.uuid()` in routes/disputes.ts): an id that cannot be a
// uuid can only ever come back as a 400, so the page renders its error state without spending a
// request — and without the red "Failed to load resource" line that request would leave in the
// console.
const disputeIdSchema = z.uuid();

export function isValidDisputeId(disputeId: string) {
  return disputeIdSchema.safeParse(disputeId).success;
}

export function disputeKey(disputeId: string) {
  return ['dispute', disputeId] as const;
}

/** The dispute file itself. */
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

/** How long a dispute nobody settles survives before the job cancels the match outright. */
export const DISPUTE_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Milliseconds left before the job cancels a dispute OPENED at `createdAt` — negative once the
 * window is past, `null` on an unparsable instant.
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

/** What THIS camp declared: the name of the side it says won, or `null` when it never reported. */
export function claimedWinnerName(
  side: DisputeSide,
  sides: DisputeSide[],
  solo: boolean,
): string | null {
  const winner = sideById(sides, side.submittedWinnerSideId);
  return winner ? sideName(winner, solo) : null;
}

/** Do the two camps really contradict each other? */
export function claimsContradict(sides: DisputeSide[]) {
  const claims = sides.map((side) => side.submittedWinnerSideId);
  if (claims.length < 2) return false;
  if (claims.some((claim) => claim === null)) return false;

  return claims[0] !== claims[1];
}

/** Was this file closed by the 24 h JOB rather than by a human arbiter? */
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
      // TWO SENTENCES FOR ONE ENUM VALUE, and they must coexist: an admin can legitimately
      // choose `cancelled` when he cannot separate the camps, AND the job writes exactly the
      // same value when nobody turns up.
      return settledByTimeout(dispute)
        ? 'Nobody settled this dispute within 24 hours, so the match was cancelled automatically. It counts for nothing, and no Elo was applied to either side.'
        : 'The admin could not separate the two camps, so the match was cancelled. No Elo was applied to either side.';
    case null:
      return null;
  }
}

// ---------------------------------------------------------------- attachments

/** What a presigned evidence url can be rendered as. */
export type Attachment = { kind: 'image' | 'file'; href: string; label: string };

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/**
 * Turns an `evidenceUrl` into something renderable, or `null` when it must not be rendered at
 * all.
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

/** The client echo of what `POST /disputes/{id}/evidence` accepts. */
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

/** May this viewer file a piece of evidence, and if not, why not? */
export function canSubmitEvidence(
  file: DisputeFile,
  meId: string | undefined,
  nowMs: number,
): EvidenceEligibility {
  const solo = isSoloMatch(file.match);
  const mySide =
    (meId
      ? file.sides.find((side) =>
          // In 1v1 the PLAYER is the camp (the line-up holds exactly one name); from 2v2 up
          // only the captain speaks for his team. Same split as the backend.
          solo ? side.players.some((player) => player.id === meId) : side.team?.captainId === meId,
        )
      : undefined) ?? null;

  // Checked before the party guard, unlike the server — which hides the state from a stranger
  // on purpose (no open/resolved oracle).
  if (file.dispute.status !== 'open') return { mySide, blocker: 'settled' };

  if (!mySide) return { mySide: null, blocker: 'not_a_party' };

  // THE MATCHMAKING BOARD'S RACE, APPLIED HERE.
  const left = disputeMsLeft(file.dispute, nowMs);
  if (left !== null && left <= 0) return { mySide, blocker: 'window_closed' };

  return { mySide, blocker: null };
}
