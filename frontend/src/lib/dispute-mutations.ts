import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, sharedApiErrorMessage } from '@/lib/api';
import { EVIDENCE_MAX_MB, disputeKey } from '@/lib/dispute-detail';
import { uploadFile } from '@/lib/upload';

import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of the dispute file: filing one piece of evidence.
 *
 * The read side (`lib/dispute-detail.ts`) stays untouched — queries and mutations have opposite
 * lifecycles (cached vs. one-shot), and mixing them in one module makes it impossible to see at
 * a glance what invalidates what. Same split as `team-detail`/`team-mutations` and
 * `match-detail`/`match-mutations`.
 *
 * 🚨 ARBITRATION IS NOT HERE AND MUST NOT COME HERE. `POST /disputes/{id}/resolve` is admin-only
 * and belongs to [F-ADMIN]; this module knows one route.
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
 */
export function isDisputeSettledElsewhere(error: unknown) {
  return error instanceof ApiError && error.status === 409;
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
