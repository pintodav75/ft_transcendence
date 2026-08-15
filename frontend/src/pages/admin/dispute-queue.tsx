import { Gavel } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { Callout } from '@/components/ui/callout';
import { ErrorPanel } from '@/components/ui/error-panel';
import { MatchLineLink } from '@/components/matches/MatchLineLink';
import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';
import { buttonClasses } from '@/components/ui/button-variants';
import { DISPUTE_WINDOW_HOURS } from '@/lib/dispute-detail';
import { disputeAgeMs, disputeQueueMsLeft, useDisputeQueue, useIsAdmin } from '@/lib/admin-disputes';
import { formatDuration, formatMatchDate, isSoloMatch, sideAvatarUrl, sideInitials, sideName } from '@/lib/match-detail';
import { ladderSubtitle } from '@/lib/team-detail';
import { matchAccentClass } from '@/components/matches/match-status';
import { useSlotClock } from '@/lib/matchmaking';

import type { DisputeQueueEntry, DisputeQueueSide } from '@/lib/admin-disputes';

/** How many pieces of evidence the two camps have filed, in words. */
function evidenceText(count: number) {
  if (count === 0) return 'no evidence yet';
  return count === 1 ? '1 piece of evidence' : `${count} pieces of evidence`;
}

/** One camp: its logo (or the player's avatar in 1v1) and its name. */
function Camp({ side, solo }: { side: DisputeQueueSide | undefined; solo: boolean }) {
  if (!side) {
    // The contract types `sides` as a list, so "fewer than two" is representable even though
    // the domain never produces it.
    return <span className="text-sm text-text-muted">—</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar
        src={sideAvatarUrl(side, solo)}
        alt=""
        fallback={sideInitials(side, solo)}
        className="size-7 shrink-0"
      />
      <span className="min-w-0 truncate text-sm font-bold text-text-primary">
        {sideName(side, solo)}
      </span>
    </span>
  );
}

/** One file waiting on an arbiter. */
function QueueRow({ entry, nowMs }: { entry: DisputeQueueEntry; nowMs: number }) {
  // The shared rule takes a match-shaped object; the queue serves the format flat.
  const solo = isSoloMatch({ ladder: { format: entry.format } });
  const [home, away] = entry.sides;
  // Same rule as the team page, the match sheet and the dispute file: "Chess 1v1" next to
  // "Chess · 1v1" says the same thing three times, so the ladder's own name is kept only when
  // it adds something.
  const extraName = ladderSubtitle(entry.ladderName, entry.gameName, entry.format);

  const age = disputeAgeMs(entry, nowMs);
  const left = disputeQueueMsLeft(entry, nowMs);

  return (
    <MatchLineLink
      target={{ kind: 'dispute', disputeId: entry.id }}
      // Every row of this page is a dispute, so the accent is constant — but it is READ from
      // the shared mapping rather than written as `border-l-arena-red`, so a row here keeps
      // matching the same match everywhere else in the app.
      accentClass={matchAccentClass('dispute')}
    >

      <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1.5">
        <Camp side={home} solo={solo} />
        <span className="text-xs label-caps text-text-muted">vs</span>
        <Camp side={away} solo={solo} />
      </span>

      <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span>{entry.gameName}</span>
        <Pill tone="muted">{entry.format}</Pill>
        {extraName ? <span>{extraName}</span> : null}
        <span className="font-mono normal-case">{formatMatchDate(entry.scheduledAt)}</span>
        <span>{evidenceText(entry.evidenceCount)}</span>

        {left === null ? null : left > 0 ? (
          <span className="ms-auto font-bold text-text-primary">{formatDuration(left)} left</span>
        ) : (
          <Pill tone="dispute" className="ms-auto">
            Window closed
          </Pill>
        )}
      </span>

      {age === null ? null : (
        <span className="basis-full text-xs text-text-muted">
          Opened {formatDuration(age)} ago
        </span>
      )}
    </MatchLineLink>
  );
}

/**
 * `/admin/disputes` — the arbitration queue: every dispute still waiting on an admin, oldest
 * first.
 */
export function DisputeQueue() {
  const isAdmin = useIsAdmin();
  const queueQuery = useDisputeQueue(isAdmin);

  /** The instant the 24 h deadlines are measured against. */
  const nowMs = Math.max(useSlotClock(), queueQuery.dataUpdatedAt);

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6 py-6">

        <ErrorPanel
          title="Reserved for admins"
          message="This is the arbitration queue: only the admins who settle disputes can open it. If one of your own matches is in dispute, it is on your history — open it from there to follow it and file your evidence."
        >
          <Link to="/history" className={buttonClasses('secondary')}>
            Back to my matches
          </Link>
        </ErrorPanel>
      </div>
    );
  }

  const disputes = queueQuery.data?.disputes ?? [];

  return (
    <div className="panel flex min-w-0 flex-col gap-6 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-arena-red">
          <Gavel aria-hidden="true" className="size-4" /> Arbitration
        </p>
        <h1 className="text-3xl label-caps-black">Disputes to settle</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Every match whose two camps reported different results, oldest first. Each file is
          cancelled automatically {DISPUTE_WINDOW_HOURS} hours after it was opened — the match then
          counts for nothing and no Elo moves for either side, so the one at the top is the one to
          open first. Opening a file shows both claims and the evidence they filed.
        </p>
      </header>

      {queueQuery.isError && (
        <Callout tone="danger">
          The arbitration queue could not be loaded. Check your connection and reload the page.
        </Callout>
      )}

      {queueQuery.isPending && (
        <>
          {/* Same footprint as a couple of rows so the layout does not jump. */}
          <div
            aria-hidden="true"
            className="h-32 animate-pulse rounded-card border border-border-subtle bg-surface-card"
          />

          <p role="status" className="text-sm text-text-muted">
            Loading the arbitration queue…
          </p>
        </>
      )}

      {!queueQuery.isPending && !queueQuery.isError && (
        <>
          <SectionTitle>
            {disputes.length === 1 ? '1 open dispute' : `${disputes.length} open disputes`}
          </SectionTitle>

          {disputes.length === 0 ? (
            // `muted`, JAMAIS `danger` : « rien à arbitrer » est le cas NOMINAL d'une
            // plateforme qui tourne bien, pas une panne.
            <Callout tone="muted">
              No dispute is waiting on an arbiter right now. A file appears here as soon as two
              camps report different results for the same match.
            </Callout>
          ) : (
            // `role="list"` explicite : Safari retire le rôle de liste d'un `<ul>` dont le
            // `display` n'est pas `list-item`. Nommée, pour que le lecteur sache LAQUELLE.
            <ul role="list" aria-label="Disputes to settle" className="flex flex-col gap-2">
              {disputes.map((entry) => (
                <li key={entry.id}>
                  <QueueRow entry={entry} nowMs={nowMs} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
