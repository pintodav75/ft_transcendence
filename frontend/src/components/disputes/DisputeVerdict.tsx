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

/** Where this file stands: still waiting on an admin, or settled — and with what consequence. */
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

      <Callout tone={dispute.resolution === 'cancelled' ? 'muted' : 'success'}>

        <strong className="text-text-primary">
          {byTimeout ? 'Cancelled automatically' : 'Settled by an admin'}
        </strong>
        {dispute.resolvedAt ? ` on ${formatMatchDate(dispute.resolvedAt, 'long')}` : ''}.{' '}

        {verdict ?? 'The outcome was recorded on the match itself.'} This file is now read-only.
      </Callout>

      {!byTimeout && (
        <div className="flex flex-col gap-1.5 rounded-control border border-border-subtle bg-surface-card-strong/60 px-4 py-3">
          <p className="text-xs label-caps text-text-muted">Admin&apos;s note</p>

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
