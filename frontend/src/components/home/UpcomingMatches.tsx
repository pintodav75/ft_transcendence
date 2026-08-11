import { CalendarClock, Hourglass } from 'lucide-react';

import { MatchLineLink } from '@/components/matches/MatchLineLink';
import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';
import { formatClockTime, formatCountdown } from '@/lib/home';
import { formatMatchDate } from '@/lib/match-detail';
import { matchAccentClass, matchStatusView } from '@/components/matches/match-status';
import { matchOpponentView } from '@/lib/solo';

import type { HistoryMatch, MatchLadderLabel } from '@/lib/history';
import type { UpcomingMatch } from '@/lib/home';

type UpcomingMatchesProps = {
  /** Already partitioned and sorted soonest first by `upcomingMatches` — empty renders nothing. */
  rows: UpcomingMatch[];
  ladderOf: (match: HistoryMatch) => MatchLadderLabel;
  /**
   * The instant the countdowns are measured against. Ticks (see `useSlotClock`) so a tab left
   * open keeps counting down instead of freezing on the value it was mounted with.
   */
  nowMs: number;
};

/** « Counter-Strike 2 5v5 » — the ladder, or the pair that identifies it when its name is unknown. */
function ladderLabel(ladder: MatchLadderLabel) {
  return ladder.ladderName ?? `${ladder.game} ${ladder.format}`;
}

/**
 * « What is ahead of me », and the only place in the app that shows a slot's WITHDRAWAL
 * DEADLINE.
 */
export function UpcomingMatches({ rows, ladderOf, nowMs }: UpcomingMatchesProps) {
  if (rows.length === 0) return null;

  const [featured, ...rest] = rows;

  return (
    // A plain `<div>` + `SectionTitle`, exactly like `ActionRequired`: the `<h2>` already
    // structures the document, and a `<section>` would need an id to be labelled by it.
    <div className="flex flex-col gap-3">
      <SectionTitle>Next up</SectionTitle>

      <FeaturedMatch row={featured} ladderOf={ladderOf} nowMs={nowMs} />

      {rest.length > 0 && (
        // Named so a screen reader hears WHICH list this is — the page holds several — and so a
        // selector can target it rather than any `<ul>` on the page.
        <ul role="list" aria-label="Later matches" className="flex flex-col gap-2">
          {rest.map((row) => {
            const status = matchStatusView(row.match);

            return (
              <li key={row.match.id}>

                <MatchLineLink
                  target={{ kind: 'match', matchId: row.match.id }}
                  accentClass={matchAccentClass(status.tone)}
                >

                  <Pill tone={status.tone}>{status.label}</Pill>
                  <span className="text-sm font-bold text-text-primary">
                    {ladderLabel(ladderOf(row.match))}
                  </span>
                  <Opponent match={row.match} />
                  <span className="font-mono text-xs text-text-secondary">
                    {formatMatchDate(row.match.scheduledAt)}
                  </span>

                  <span className="font-mono text-xs tabular-nums text-text-secondary sm:ms-auto">
                    {formatCountdown(row.atMs, nowMs)}
                  </span>
                  {row.withdrawnAtMs !== null && (
                    <WithdrawalNote withdrawnAtMs={row.withdrawnAtMs} nowMs={nowMs} compact />
                  )}
                </MatchLineLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The soonest commitment, given the room it deserves. */
function FeaturedMatch({
  row,
  ladderOf,
  nowMs,
}: {
  row: UpcomingMatch;
  ladderOf: (match: HistoryMatch) => MatchLadderLabel;
  nowMs: number;
}) {
  const ladder = ladderLabel(ladderOf(row.match));
  const status = matchStatusView(row.match);
  /**
   * THE DEADLINE BELONGS IN THE LABEL, because an `aria-label` REPLACES the link's contents:
   * whoever browses by links (or by headings, then Tab) hears the label and nothing else.
   */
  const withdrawal =
    row.withdrawnAtMs !== null ? ` ${withdrawalText(row.withdrawnAtMs, nowMs)}` : '';

  return (
    <MatchLineLink
      target={{ kind: 'match', matchId: row.match.id }}
      accentClass={matchAccentClass(status.tone)}
      // Fifty links called "Counter-Strike 2 5v5" tell a screen-reader user nothing about which
      // one he is on, and this one is the page's headline: it names what it is.
      ariaLabel={`Next match: ${ladder}, ${formatCountdown(row.atMs, nowMs)}.${withdrawal} Open its sheet.`}
    >
      <span className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={status.tone}>{status.label}</Pill>
          <span className="truncate text-base font-bold text-text-primary">{ladder}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
          <Opponent match={row.match} />
          <span className="flex items-center gap-1.5 font-mono text-xs">
            <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
            {formatMatchDate(row.match.scheduledAt, 'long')}
          </span>
        </span>
        {row.withdrawnAtMs !== null && (
          <WithdrawalNote withdrawnAtMs={row.withdrawnAtMs} nowMs={nowMs} />
        )}
      </span>

      <span className="font-mono text-xl font-bold tabular-nums text-text-primary sm:ms-auto">
        {formatCountdown(row.atMs, nowMs)}
      </span>
    </MatchLineLink>
  );
}

/**
 * Never `match.opponent` directly: `null` has FOUR causes and two of them mean somebody really
 * played and then vanished.
 */
function Opponent({ match }: { match: HistoryMatch }) {
  const opponent = matchOpponentView(match);
  if (!opponent) return null;

  return <span className="truncate text-sm text-text-secondary">vs {opponent.name}</span>;
}

/** « Nobody has accepted — withdrawn at 20:45 », as a plain string. */
function withdrawalText(withdrawnAtMs: number, nowMs: number) {
  return withdrawnAtMs <= nowMs
    ? 'Nobody accepted it in time — it is being withdrawn.'
    : `Nobody has accepted yet — withdrawn at ${formatClockTime(withdrawnAtMs)}.`;
}

function WithdrawalNote({
  withdrawnAtMs,
  nowMs,
  compact = false,
}: {
  withdrawnAtMs: number;
  nowMs: number;
  compact?: boolean;
}) {
  return (
    <span
      className={
        compact
          ? 'flex w-full items-center gap-1.5 text-xs text-text-secondary'
          : 'flex items-center gap-1.5 text-xs text-text-secondary'
      }
    >
      <Hourglass aria-hidden="true" className="size-3.5 shrink-0" />
      {withdrawalText(withdrawnAtMs, nowMs)}
    </span>
  );
}
