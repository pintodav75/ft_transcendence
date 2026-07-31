import { Callout } from '@/components/ui/callout';
import {
  DISPUTE_WINDOW_HOURS,
  disputeMsLeft,
  resolutionVerdict,
  settledByTimeout,
} from '@/lib/dispute-detail';
import { formatDuration, formatMatchDate } from '@/lib/match-detail';

import type { Dispute, DisputeSide } from '@/lib/dispute-detail';

type DisputeVerdictProps = {
  dispute: Dispute;
  sides: DisputeSide[];
  /** `isSoloMatch(file.match)` — decided by the LADDER'S FORMAT, never by a missing team. */
  solo: boolean;
  /** Read at render by the page — see its comment on the clock this page runs against. */
  nowMs: number;
};

/**
 * Where this file stands: still waiting on an admin, or settled — and with what consequence.
 *
 * 🚨 IT STATES, IT NEVER ACTS — same division of labour as `MatchStateNotice` on the match sheet.
 * Ruling on a dispute is admin-only and belongs to [F-ADMIN], which will add its controls to this
 * page WITHOUT touching this component.
 *
 * 🔑 THE DEADLINE IS THE POINT OF THE BLOCK. A dispute nobody settles is CANCELLED after
 * {@link DISPUTE_WINDOW_HOURS} hours (job C, `backend/src/jobs/index.ts`) — the match counts for
 * nothing and no Elo moves. Someone who does not know that has no reason to hurry, and losing by
 * default is exactly what this page exists to prevent.
 *
 * ⚠️ THESE 24 h ARE NOT THE 24 h OF A REPORTED SCORE. That other window runs from a SUBMISSION and
 * ends by APPLYING the submitted result; this one runs from the OPENING of the dispute and ends by
 * CANCELLING the match. Two mechanisms, two clocks, opposite outcomes — see `DISPUTE_WINDOW_HOURS`.
 *
 * 🚨 A SETTLED FILE HAS TWO VERY DIFFERENT AUTHORS, AND CONFLATING THEM IS THE DEFECT REVIEW
 * CAUGHT: the 24 h job writes the SAME columns an arbiter would. Every attribution below is
 * therefore gated on `settledByTimeout` — see it for the exact rule and for why the note block
 * disappears rather than falling back.
 */
export function DisputeVerdict({ dispute, sides, solo, nowMs }: DisputeVerdictProps) {
  if (dispute.status === 'open') {
    const left = disputeMsLeft(dispute, nowMs);

    return (
      <Callout tone="danger">
        <strong className="text-text-primary">This dispute is still open.</strong> The two camps
        reported different results, so the match is on hold and nothing has been applied to the
        ladder. An admin has to settle it — until then, each camp&apos;s captain (the player
        himself in 1v1) can file evidence for it.{' '}
        {left === null ? null : left > 0 ? (
          <>
            If nobody settles it, the match is cancelled automatically and counts for nothing —{' '}
            <strong className="text-text-primary">{formatDuration(left)}</strong> left.
          </>
        ) : (
          <>
            The {DISPUTE_WINDOW_HOURS}-hour window has run out: the match is about to be cancelled
            automatically, and no further evidence can be filed.
          </>
        )}
      </Callout>
    );
  }

  const verdict = resolutionVerdict(dispute, sides, solo);
  const byTimeout = settledByTimeout(dispute);

  return (
    <div className="flex flex-col gap-3">
      {/* `success` only when a winner was actually ruled: a cancelled match is an outcome, not a
          good one, and painting it green would misread the file at a glance. */}
      <Callout tone={dispute.resolution === 'cancelled' ? 'muted' : 'success'}>
        {/* 🚨 THE HEADLINE MUST NOT NAME AN ARBITER WHO NEVER CAME. The 24 h job writes the very
            same columns a human would, so "Settled by an admin" was FALSE on the only path to
            `resolved` the product can currently take ([F-ADMIN] does not exist, so nothing calls
            `POST /disputes/{id}/resolve`). */}
        <strong className="text-text-primary">
          {byTimeout ? 'Cancelled automatically' : 'Settled by an admin'}
        </strong>
        {dispute.resolvedAt ? ` on ${formatMatchDate(dispute.resolvedAt, 'long')}` : ''}.{' '}
        {/* `resolution` is `null` only while a dispute is open, so this branch is unreachable —
            mapped anyway rather than rendering an empty sentence on a contract that allows it. */}
        {verdict ?? 'The outcome was recorded on the match itself.'} This file is now read-only.
      </Callout>

      {/* 🚨 NO NOTE BLOCK AT ALL ON A TIMEOUT. What the job stores in `resolutionNotes` is an
          INTERNAL LOG LINE — French prose written for a developer, not for the two camps — and
          there is no arbiter whose reasoning it could be. Suppressing the whole block, rather
          than falling back to "no note", is what stops the screen from implying that someone
          looked at the file and chose to say nothing. */}
      {!byTimeout && (
        <div className="flex flex-col gap-1.5 rounded-control border border-border-subtle bg-surface-card-strong/60 px-4 py-3">
          <p className="text-xs label-caps text-text-muted">Admin&apos;s note</p>
          {/* `resolutionNotes` IS NULLABLE and `POST /disputes/{id}/resolve` makes the note
              OPTIONAL, so an admin decision with no note is ordinary. Saying so beats an empty box
              that reads as a rendering fault. `whitespace-pre-line` keeps the line breaks he typed. */}
          {dispute.resolutionNotes ? (
            <p className="max-w-prose whitespace-pre-line text-sm text-text-secondary">
              {dispute.resolutionNotes}
            </p>
          ) : (
            <p className="max-w-prose text-sm text-text-secondary">
              The admin left no note with this decision.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
