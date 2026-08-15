import { ArrowLeft, Gavel, History as HistoryIcon } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import { ApiError } from '@/lib/api';
import { DisputeArbitration } from '@/components/disputes/DisputeArbitration';
import { DisputeClaims } from '@/components/disputes/DisputeClaims';
import { DisputeVerdict } from '@/components/disputes/DisputeVerdict';
import { ErrorPanel } from '@/components/ui/error-panel';
import { EvidenceForm } from '@/components/disputes/EvidenceForm';
import { EvidenceThread } from '@/components/disputes/EvidenceThread';
import { GameBanner } from '@/components/games/GameBanner';
import { Pill } from '@/components/ui/pill';
import { backLinkClasses } from '@/lib/back-navigation';
import { buttonClasses } from '@/components/ui/button-variants';
import { isValidDisputeId, useDispute } from '@/lib/dispute-detail';
import { formatMatchDate, isSoloMatch, sideName } from '@/lib/match-detail';
import { ladderSubtitle } from '@/lib/team-detail';
import { useAnnouncement } from '@/lib/use-announcement';
import { useSlotClock } from '@/lib/matchmaking';

import type { DisputeSide } from '@/lib/dispute-detail';

function BackToHistory() {
  return (
    <Link to="/history" className={buttonClasses('secondary')}>
      <HistoryIcon aria-hidden="true" className="mr-2 size-4" />
      Back to my matches
    </Link>
  );
}

/** "Team Alpha vs Team Bravo" — a dispute always has two camps, but the payload is a list. */
function disputeTitle(sides: DisputeSide[], solo: boolean) {
  const [home, away] = sides;
  if (!home) return 'Dispute';
  if (!away) return sideName(home, solo);
  return `${sideName(home, solo)} vs ${sideName(away, solo)}`;
}

/**
 * `/disputes/$disputeId` — the dispute file: what each camp claims, the thread of evidence, the
 * verdict, and (for a camp) the form that files a screenshot.
 */
export function DisputeDetail() {
  const { disputeId } = useParams({ from: '/_authenticated/disputes/$disputeId' });
  const headingId = useId();
  /**
   * Landing point for the focus when the evidence form disappears under the user (an admin
   * ruled while the tab sat open).
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** THE ONLY `role="status"` OF THIS SCREEN (invariant #11). */
  const announcement = useAnnouncement();

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so the
  // error state is rendered without spending a request — and without the red "Failed to load
  // resource" line that request would leave in the console.
  const validId = isValidDisputeId(disputeId);
  const disputeQuery = useDispute(disputeId, validId);

  /**
   * The instant the 24 h deadline is measured against — and, since it decides whether the
   * evidence form is offered at all, it must ADVANCE.
   */
  const nowMs = Math.max(useSlotClock(), disputeQuery.dataUpdatedAt);

  if (!validId) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Invalid dispute link"
          message="This dispute identifier is not a valid id. Check the link you followed, or open the dispute from the match it belongs to."
        >
          <BackToHistory />
        </ErrorPanel>
      </div>
    );
  }

  if (disputeQuery.isError) {
    const status = disputeQuery.error instanceof ApiError ? disputeQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 403 ? (
          // Neither an outage nor a dead end: the file EXISTS, it is simply private. Saying so
          // is what stops someone reloading for ever.
          <ErrorPanel
            title="Reserved for the two camps"
            message="Only the players and team-mates engaged in this match — and the admins who arbitrate it — can read its dispute file."
          >
            <BackToHistory />
          </ErrorPanel>
        ) : status === 404 ? (
          <ErrorPanel
            title="Dispute not found"
            message="No dispute answers to this link. It may belong to a match that no longer exists, or the link may simply be mistyped."
          >
            <BackToHistory />
          </ErrorPanel>
        ) : (
          <ErrorPanel
            title="Dispute unavailable"
            message="This dispute file could not be loaded. Check your connection and reload the page."
          >
            <BackToHistory />
          </ErrorPanel>
        )}
      </div>
    );
  }

  if (!disputeQuery.data) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {/* Same footprint as the loaded panel so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />

        <p role="status" className="text-sm text-text-muted">
          Loading the dispute file…
        </p>
      </div>
    );
  }

  const file = disputeQuery.data;
  const { dispute, match, sides, evidence } = file;
  const { ladder } = match;
  const solo = isSoloMatch(match);
  // Same rule as the team page and the match sheet: "Chess 1v1" next to "Chess · 1v1" reads the
  // same thing three times, so the ladder's own name is kept only when it adds something.
  const extraName = ladderSubtitle(ladder.name, ladder.gameName, ladder.format);

  /** Say it, and land the focus somewhere that still exists. */
  function announceAndRefocus(text: string) {
    announcement.announce(text);
    // The panel is unmounting with the refetch; the `<h1>` names the file, so a screen reader
    // reads something useful on arrival instead of restarting from `<body>`.
    headingRef.current?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">

      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      <section aria-labelledby={headingId} className="panel flex min-w-0 flex-col gap-8 p-6">
        <header className="space-y-1">
          <GameBanner
            gameId={ladder.gameId}
            name={ladder.gameName}
            className="-mx-6 -mt-6 mb-4 h-32 sm:h-36"
          />

          <p className="flex items-center gap-2 text-xs label-caps text-success">
            <Gavel aria-hidden="true" className="size-4" /> Dispute
          </p>

          <h1
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring rounded-control wrap-break-word text-3xl label-caps-black"
          >
            {disputeTitle(sides, solo)}
          </h1>

          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs label-caps text-text-secondary">
            <span>{ladder.gameName}</span>
            <Pill tone="muted">{ladder.format}</Pill>
            {extraName && <span>{extraName}</span>}
            <span className="normal-case">{formatMatchDate(match.scheduledAt, 'long')}</span>
            <Pill tone={dispute.status === 'open' ? 'dispute' : 'settled'}>
              {dispute.status === 'open' ? 'Open dispute' : 'Settled'}
            </Pill>
          </div>

          <div className="flex pt-3">
            <Link
              to="/matches/$matchId"
              params={{ matchId: match.id }}
              className={backLinkClasses}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Match sheet — maps, line-ups and scores
            </Link>
          </div>
        </header>

        <DisputeVerdict dispute={dispute} sides={sides} solo={solo} nowMs={nowMs} />

        <DisputeClaims sides={sides} solo={solo} />

        <EvidenceThread evidence={evidence} sides={sides} solo={solo} />

        <EvidenceForm
          file={file}
          nowMs={nowMs}
          onFiled={announcement.announce}
          onSettledElsewhere={announceAndRefocus}
        />

        <DisputeArbitration
          file={file}
          nowMs={nowMs}
          returnFocusRef={headingRef}
          onSettled={announceAndRefocus}
        />

        <p className="text-xs text-text-muted">
          Only an admin can settle a dispute. There is no messaging with them: what they read is
          this thread.
        </p>
      </section>
    </div>
  );
}
