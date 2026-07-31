import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { EVIDENCE_MAX_MB, disputeKey } from '@/lib/dispute-detail';
import { disputeQueueKey } from '@/lib/admin-disputes';
import { uploadFile } from '@/lib/upload';

import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of the dispute file: filing one piece of evidence, and — since [F-ADMIN] —
 * SETTLING the dispute.
 *
 * The read side (`lib/dispute-detail.ts`) stays untouched — queries and mutations have opposite
 * lifecycles (cached vs. one-shot), and mixing them in one module makes it impossible to see at
 * a glance what invalidates what. Same split as `team-detail`/`team-mutations` and
 * `match-detail`/`match-mutations`.
 *
 * ⚠️ THIS DOCBLOCK USED TO SAY "ARBITRATION IS NOT HERE AND MUST NOT COME HERE". It was written
 * while [F-ADMIN] did not exist, and that ticket has now landed: `POST /disputes/{id}/resolve`
 * lives right below, next to the route it shares its 409 with. The read side of the queue —
 * everything gated on `isAdmin` — is in `lib/admin-disputes.ts`, which is where the guard is
 * stated. Leaving the old sentence standing would have cost the next reader a quarter of an hour.
 */
type SubmitEvidenceResponse =
  paths['/disputes/{id}/evidence']['post']['responses'][201]['content']['application/json'];

export type SubmitEvidenceVariables = {
  file: File;
  /** Mandatory, non-empty after trim — the server refuses a bare attachment in 400. */
  message: string;
};

// ---------------------------------------------------------------- error mapping

/**
 * Turns the route's refusals into something a human can act on.
 *
 * ⚠️ NONE of these carries a stable `code` (unlike the invitation routes of B-INV), and invariant
 * #8 forbids routing a message on the server's prose — it is display text the backend may
 * reword. The status alone is the whole signal.
 */
export function submitEvidenceErrorMessage(error: unknown) {
  // 403 (neither captain nor player of a camp — a page left open while the team changed hands)
  // and 429 (30/min on this route).
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Its own status, deliberately NOT folded into the 400 below: "too large" has a remedy the
    // reader can act on, where "malformed" has none. Pre-empted by the picker, which checks the
    // size client-side; this is the net for a file that slips through (a browser reporting a
    // stale `size`, a future cap change on the server only).
    if (error.status === 413) {
      return `That file is too large — the limit is ${EVIDENCE_MAX_MB} MB.`;
    }

    if (error.status === 400) {
      // Three reachable causes, and the form pre-empts all three: the picker enforces the MIME
      // list, the schema enforces a non-empty message, and `uploadFile` sends exactly the two
      // parts the route allows. The sentence names the two a human can do something about.
      return 'This evidence was refused: attach a PNG, JPEG, WebP or PDF file and write a message explaining it.';
    }

    if (error.status === 404) return 'This dispute no longer exists.';

    // An admin ruled — or the 24 h job cancelled it — while this page sat open.
    if (error.status === 409) {
      return 'This dispute has just been settled, so it no longer accepts evidence. The page is refreshing.';
    }
  }

  return 'Could not file this evidence.';
}

/**
 * Is this the ONE refusal that pulls the screen out from under its own error message?
 *
 * ⚠️ A 409 means the dispute was settled while this tab sat open. It triggers a refetch, the
 * refetch turns the file read-only, and the form that holds this message UNMOUNTS with it — so
 * the sentence above is, on its own, written never to be read. The caller routes the news to the
 * page's live region instead, the one element that survives the unmount. Same idiom as
 * `isSettledElsewhere` on the match sheet and `isSlotGone` on the board.
 *
 * 🔑 SHARED VERBATIM BY BOTH ROUTES OF THIS MODULE ([F-ADMIN]), and the two 409s mean exactly the
 * same thing: somebody else closed this file first — the 24 h job, or another arbiter. Writing a
 * second predicate for `resolve` would have been two names for one fact.
 */
export function isDisputeSettledElsewhere(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Turns the refusals of `POST /disputes/{id}/resolve` into something an arbiter can act on.
 *
 * ⚠️ 403 IS MAPPED THROUGH THE SHARED HELPER AND MUST STAY REACHABLE-BUT-UNSEEN: the panel is
 * only ever rendered to an admin, so this can only fire on a page left open across a demotion.
 * The same discipline as everywhere else in the repo — map it, never rely on it.
 */
export function resolveDisputeErrorMessage(error: unknown) {
  // 403 (not, or no longer, an admin) and 429 (the shared quota).
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // The radio group can only ever produce one of the three enum values and the note is capped
    // client-side, so this is the net for a contract change, not a reachable state.
    if (error.status === 400) {
      return 'This ruling was refused: pick one of the three outcomes, and keep the note under 1000 characters.';
    }

    if (error.status === 404) return 'This dispute no longer exists.';

    // The 24 h job, or another arbiter, closed the file while this page sat open.
    if (error.status === 409) {
      return 'This dispute has just been settled, so it can no longer be arbitrated. The page is refreshing.';
    }
  }

  return 'Could not settle this dispute.';
}

// ----------------------------------------------------------------------- hook

/**
 * Files one piece of evidence: a file AND a message, in a single multipart request.
 *
 * 🔑 IT GOES THROUGH `uploadFile` (XHR), NOT `apiFetch` (fetch), and that is the entire reason
 * `lib/upload.ts` grew a `fields` option: `fetch` has no upload-progress event, so a 5 MB
 * screenshot would upload behind a frozen button with nothing to show. This is the exact gap
 * review flagged on [F4].
 *
 * ⚠️ THE BODY IS EXACTLY TWO PARTS. The route caps it at `files: 1, fields: 1, parts: 2`; a
 * third entry — even an empty one — is a 400.
 *
 * ⚠️ THE 201 IS DELIBERATELY IGNORED. It carries no `evidenceUrl`, because the column holds a
 * PRIVATE object key rather than a url: only `GET /disputes/{id}` can presign it. So the thread
 * is refreshed from the server rather than patched locally — which is also why no optimistic
 * update is attempted here (there would be nothing to show, and nothing to roll back to).
 *
 * The invalidation promise is returned from `onSuccess` (repo idiom): the mutation stays
 * `isPending` until the thread really shows the new post, instead of the form clearing itself one
 * frame before the evidence appears.
 */
export function useSubmitEvidence(disputeId: string, onProgress?: (percent: number) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, message }: SubmitEvidenceVariables) =>
      uploadFile<SubmitEvidenceResponse>(
        `/disputes/${encodeURIComponent(disputeId)}/evidence`,
        file,
        { field: 'evidence', fields: { message }, onProgress },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: disputeKey(disputeId) }),
    // A 409 means the screen is LYING (an admin ruled, or the job cancelled the dispute, while
    // this tab sat open): the message alone would leave the same dead form on display.
    // ⚠️ Deliberately NOT on 404 — refetching a dispute that no longer exists would replay the
    // 404 and print "Failed to load resource" in the console, which is a rejection criterion.
    onError: (error) =>
      isDisputeSettledElsewhere(error)
        ? queryClient.invalidateQueries({ queryKey: disputeKey(disputeId) })
        : undefined,
  });
}

// ------------------------------------------------------------------ arbitration

type ResolveDisputeBody =
  paths['/disputes/{id}/resolve']['post']['requestBody']['content']['application/json'];
type ResolveDisputeResponse =
  paths['/disputes/{id}/resolve']['post']['responses'][200]['content']['application/json'];

/** The three outcomes an arbiter may pick — a closed enum straight from the contract. */
export type DisputeResolution = ResolveDisputeBody['resolution'];

export type ResolveDisputeVariables = ResolveDisputeBody;

/**
 * What the note field accepts, mirrored on the server.
 *
 * ⚠️ MIRROR, NOT A STRICTER VERSION. The route trims the note and caps it at 1000 characters,
 * and it is OPTIONAL — an arbitrage with no note is ordinary, and `DisputeVerdict` already has a
 * sentence for that case. Refusing an empty note here would forbid something the API accepts.
 */
export const RESOLUTION_NOTES_MAX = 1000;

/**
 * Settles a dispute: the ONLY exit from the `disputed` state other than the 24 h job.
 *
 * 🚨 IT IS DEFINITIVE. Naming a camp closes the match as `completed` and APPLIES Elo to both
 * sides; `cancelled` closes it as `cancelled` and leaves Elo untouched. Re-arbitrating a settled
 * file answers **409** — which is why the caller puts a `ConfirmDialog` in front of it rather
 * than a bare button.
 *
 * 🔑 TWO CACHE ENTRIES ARE INVALIDATED, AND BOTH ARE LOAD-BEARING: the FILE (so `DisputeVerdict`
 * flips to its settled state on its own, without this ticket touching that component) and the
 * QUEUE (so the row leaves `/admin/disputes` and the rail badge decrements). Refreshing only the
 * file would leave the arbiter looking at a queue that still lists work he has just done.
 *
 * ⚠️ The invalidation promise is RETURNED from `onSuccess` (repo idiom): the mutation stays
 * `isPending` until the screen really shows the verdict, instead of the panel clearing itself one
 * frame before the file turns read-only.
 *
 * ⚠️ A 409 refetches too — and for the same reason as `useSubmitEvidence`: the screen is LYING
 * (the job, or another arbiter, closed the file while this tab sat open), so the message alone
 * would leave a dead form on display. Deliberately NOT on 404: refetching a dispute that no
 * longer exists would replay the 404 and print "Failed to load resource" in the console.
 */
export function useResolveDispute(disputeId: string) {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: disputeKey(disputeId) }),
      queryClient.invalidateQueries({ queryKey: disputeQueueKey() }),
    ]);

  return useMutation({
    mutationFn: (body: ResolveDisputeVariables) =>
      apiFetch<ResolveDisputeResponse>(`/disputes/${encodeURIComponent(disputeId)}/resolve`, {
        method: 'POST',
        body,
      }),
    onSuccess: refresh,
    onError: (error) => (isDisputeSettledElsewhere(error) ? refresh() : undefined),
  });
}
