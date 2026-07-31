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
 *
 * 🔑 ONE LIST, NOT TWO. The card asked for a "next match" block and an "expiring open slots"
 * block; built as two sections they would have listed the very same rows twice, in a column
 * that is ~616 px wide between the two rails. So the open slots keep their place in the
 * schedule — they ARE commitments — and each one carries its own withdrawal line. The new
 * information is present, attached to the row it describes, and printed once.
 *
 * 🚨 THE DEADLINE HERE IS 15 MINUTES, NOT 24 HOURS. `cancelExpiredSlots` withdraws a `pending`
 * slot as soon as it falls under `MIN_LEAD_MINUTES` of its OWN kick-off — the instant nobody can
 * accept it any more. The 24 h rule is a different job (an unanswered reported score) and it
 * belongs to the « Matches on the clock » section. Copying that number here would put a wrong
 * time on screen.
 *
 * 🚨 NO IMPERATIVE AND NO CLAIM ABOUT WHO MUST ACT, on any row. `GET /matches/me` never says who
 * submitted anything, so « report your score » would be false for a bench player, for a
 * non-captain and for the side that has already reported — the wording `/history` had to walk
 * back. A row states a fact and links to the sheet, which is where the truth is.
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
        // Named so a screen reader hears WHICH list this is — the page holds several — and so
        // a selector can target it rather than any `<ul>` on the page. `role="list"` is
        // explicit: Safari drops the list role from a `<ul>` whose display is not `list-item`.
        <ul role="list" aria-label="Later matches" className="flex flex-col gap-2">
          {rest.map((row) => {
            const status = matchStatusView(row.match);

            return (
              <li key={row.match.id}>
                {/* 🔑 THE ORDER MIRRORS THE FEATURED CARD ON PURPOSE — status, ladder, opponent,
                    date on the left, countdown pushed right. The first version had the countdown
                    on the LEFT here and on the RIGHT on the card, so the eye zigzagged down the
                    section. Found by looking at the page, not by a check. */}
                {/* ⚠️ ALWAYS the match sheet here. This section lists what is COMING UP
                    (`pending`/`in_progress`), never a match in dispute — those live one section
                    below, in `ActionRequired`, which is where [F-DISPUTE] routes to a file. */}
                <MatchLineLink
                  target={{ kind: 'match', matchId: row.match.id }}
                  accentClass={matchAccentClass(status.tone)}
                >
                  {/* 🚨 THE STATUS BELONGS ON EVERY LINE, not just on the card. Without it, an
                      accepted match and an open slot were told apart only by the presence of an
                      opponent and the absence of a withdrawal note — far too implicit, and on a
                      screen made of open slots the word "OPEN SLOT" appeared exactly once. */}
                  <Pill tone={status.tone}>{status.label}</Pill>
                  <span className="text-sm font-bold text-text-primary">
                    {ladderLabel(ladderOf(row.match))}
                  </span>
                  <Opponent match={row.match} />
                  <span className="font-mono text-xs text-text-secondary">
                    {formatMatchDate(row.match.scheduledAt)}
                  </span>
                  {/* `ms-auto` only from `sm`: on a narrow screen everything wraps onto its own
                      line, where pushing it right would leave it stranded on the far edge. */}
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

/**
 * The soonest commitment, given the room it deserves.
 *
 * The countdown is the biggest thing on the card because it is the only figure the reader
 * actually acts on; the absolute date sits right under it, since « in 2 h 14 » alone cannot be
 * checked against a calendar.
 */
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
   * 🚨 THE DEADLINE BELONGS IN THE LABEL, because an `aria-label` REPLACES the link's contents:
   * whoever browses by links (or by headings, then Tab) hears the label and nothing else. Without
   * this, the one genuinely new piece of information on the page — the instant the slot gets
   * withdrawn — was announced to nobody. Same sentence as the visible note, from the same
   * function, so the two can never drift apart.
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
 * 🚨 Never `match.opponent` directly: `null` has FOUR causes and two of them mean somebody
 * really played and then vanished. `matchOpponentView` is what keeps a dash from erasing them —
 * and it reads the ladder's `format`, never the nullity of `team_id`.
 *
 * On this section a missing opponent is the ordinary case (an open slot has no second side), so
 * it renders nothing at all rather than an em dash: the withdrawal line right below already
 * says what is going on.
 */
function Opponent({ match }: { match: HistoryMatch }) {
  const opponent = matchOpponentView(match);
  if (!opponent) return null;

  return <span className="truncate text-sm text-text-secondary">vs {opponent.name}</span>;
}

/**
 * « Nobody has accepted — withdrawn at 20:45 », as a plain string.
 *
 * ⚠️ TWO STATES, because a slot does not die at its kick-off but 15 minutes before it. Past that
 * instant it is already unacceptable and merely waiting for the job's next pass — saying "will
 * be withdrawn at 20:45" then would be describing a moment that is behind us.
 *
 * 🔑 EXTRACTED SO THE FEATURED CARD'S `aria-label` READS THE SAME SENTENCE as the visible note:
 * an `aria-label` replaces the link's contents, so the two are the *only* two renderings of this
 * fact and hand-keeping them in step is how they end up disagreeing.
 */
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
