import { Link } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { useBackFrom } from '@/lib/back-navigation';
import {
  competitorAvatarUrl,
  competitorName,
  formatRecord,
  formatWinRate,
  isTeamCompetitor,
} from '@/lib/ladders';
import { cn } from '@/lib/utils';

import type { RankingEntry } from '@/lib/ladders';

/**
 * One standings line. Used by the ladder excerpt and by the full ladder page.
 *
 * the column template is shared with LadderRowHeader — one grid drawn twice, so the widths
 * have to come from a single string.
 * two layouts, and the narrow one isn't cosmetic: at 375 px on one line the fixed tracks plus
 * gaps plus padding ate 268 px of a 276 px box, and since the avatar is shrink-0 the name
 * rendered 0 px wide while the box overflowed by 73 px — silently, because LadderBoard clips.
 * below sm the numbers drop to a second line, from sm up the five-column grid is untouched.
 */
const rowClasses =
  'grid grid-cols-[2rem_1fr] items-center gap-x-2.5 gap-y-1 border-l-2 border-l-transparent border-t border-t-border-subtle px-3 py-2.5 text-sm sm:grid-cols-[2.5rem_1fr_3.5rem_3.5rem_2.75rem] sm:gap-x-3 sm:gap-y-0';

/** Visual column header. */
export function LadderRowHeader() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        rowClasses,
        // `hidden sm:grid` : sous `sm` les nombres passent SOUS le nom, une bande d'en-têtes à
        // cinq colonnes ne surmonterait donc plus rien.
        'hidden border-t-0 bg-surface-input py-2 text-xs label-caps text-text-muted sm:grid',
      )}
    >
      <span>Rank</span>
      <span>Competitor</span>
      <span>Elo</span>
      <span>W–L</span>
      <span>Rate</span>
    </div>
  );
}

type LadderRowProps = {
  entry: RankingEntry;
  /** Highlights the row and turns it into plain text: it would link to the current page. */
  isSelf?: boolean;
  /** What a screen reader hears on the highlighted row — the reason differs per screen. */
  selfNote?: string;
};

export function LadderRow({ entry, isSelf = false, selfNote }: LadderRowProps) {
  const backFrom = useBackFrom();
  // The visual column header is aria-hidden (it is a grid, not a table), so each row link
  // carries its own readable summary.
  const label = `Rank ${entry.rank}, ${competitorName(entry.competitor)}, ${entry.elo} Elo, ${entry.wins} wins ${entry.losses} losses, ${formatWinRate(entry.wins, entry.losses)} win rate`;

  const cells = (
    <>
      <span className="font-mono font-bold tabular-nums text-text-muted">{entry.rank}</span>
      <span className="flex min-w-0 items-center gap-2.5 font-bold">
        <Avatar
          src={competitorAvatarUrl(entry.competitor)}
          alt=""
          fallback={competitorName(entry.competitor).slice(0, 2).toUpperCase()}
          className="size-7 shrink-0"
        />
        <span className="truncate">{competitorName(entry.competitor)}</span>
        {isSelf && selfNote && <span className="sr-only">{selfNote}</span>}
      </span>

      <div className="col-start-2 flex items-center gap-3 text-xs sm:contents sm:text-sm">
        <span className="font-mono font-bold tabular-nums">{entry.elo}</span>
        <span className="font-mono tabular-nums text-text-secondary">
          {formatRecord(entry.wins, entry.losses)}
        </span>
        <span className="font-mono tabular-nums text-text-secondary">
          {formatWinRate(entry.wins, entry.losses)}
        </span>
      </div>
    </>
  );

  // The consulted competitor is highlighted and NOT a link: it would point at this very page.
  if (isSelf) {
    return (
      <div aria-current="true" className={cn(rowClasses, 'border-l-arena-red bg-action-primary/25')}>
        {cells}
      </div>
    );
  }

  if (isTeamCompetitor(entry.competitor)) {
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: entry.competitor.id }}
        aria-label={label}
        className={cn(rowClasses, 'focus-ring hover:bg-surface-card')}
      >
        {cells}
      </Link>
    );
  }

  return (
    <Link
      to="/players/$pseudo"
      params={{ pseudo: entry.competitor.pseudo }}
      // Tells the player page what it goes back to: this board is one of its six entrances.
      state={backFrom}
      aria-label={label}
      className={cn(rowClasses, 'focus-ring hover:bg-surface-card')}
    >
      {cells}
    </Link>
  );
}
