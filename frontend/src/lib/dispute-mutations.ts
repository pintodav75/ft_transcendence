import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { EVIDENCE_MAX_MB, disputeKey } from '@/lib/dispute-detail';
import { disputeQueueKey } from '@/lib/admin-disputes';
import { uploadFile } from '@/lib/upload';

import type { paths } from '@/lib/api-types.gen';

/**
 * Write side of the dispute file: filing evidence, and settling the dispute.
 * Read side is lib/dispute-detail.ts, the admin-gated queue is lib/admin-disputes.ts.
 *
 * queries and mutations stay in separate modules (same split as team-detail/team-mutations)
 * so you can see at a glance what invalidates what.
 */
type SubmitEvidenceResponse =
  paths['/disputes/{id}/evidence']['post']['responses'][201]['content']['application/json'];

export type SubmitEvidenceVariables = {
  file: File;
  /** Mandatory, non-empty after trim — the server refuses a bare attachment in 400. */
  message: string;
};

// ---------------------------------------------------------------- error mapping

/** Turns the route's refusals into something a human can act on. */
export function submitEvidenceErrorMessage(error: unknown) {
  // 403 (neither captain nor player of a camp — a page left open while the team changed hands)
  // and 429 (30/min on this route).
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    // Its own status, deliberately NOT folded into the 400 below: "too large" has a remedy the
    // reader can act on, where "malformed" has none.
    if (error.status === 413) {
      return `That file is too large — the limit is ${EVIDENCE_MAX_MB} MB.`;
    }

    if (error.status === 400) {
      // Three reachable causes, and the form pre-empts all three: the picker enforces the MIME
      // list, the schema enforces a non-empty message, and `uploadFile` sends exactly the two
      // parts the route allows.
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

/** Is this the ONE refusal that pulls the screen out from under its own error message? */
export function isDisputeSettledElsewhere(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

/** Turns the refusals of `POST /disputes/{id}/resolve` into something an arbiter can act on. */
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

/** Files one piece of evidence: a file AND a message, in a single multipart request. */
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

/** What the note field accepts, mirrored on the server. */
export const RESOLUTION_NOTES_MAX = 1000;

/** Settles a dispute: the ONLY exit from the `disputed` state other than the 24 h job. */
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
