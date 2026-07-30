import { useId } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { GameBanner } from '@/components/games/GameBanner';
import { StatStrip } from '@/components/ui/stat-strip';
import { formatRecord } from '@/lib/ladders';
import { ladderSubtitle } from '@/lib/team-detail';
import { EM_DASH } from '@/lib/utils';

import type { ReactNode } from 'react';
import type { RankingEntry } from '@/lib/ladders';

type SoloHeroProps = {
  gameId: string;
  gameName: string;
  ladderName: string;
  /** Always `'1v1'` here, but read from the data — the page refuses any other format. */
  format: string;
  me: { pseudo: string; displayName: string | null; avatarUrl: string | null };
  /**
   * My line on this ladder, or `undefined` when I have none yet. On a solo ladder that is the
   * NORMAL state of a new account: a line is created by the first match RESULT, and there is
   * no enrolment to make it appear earlier. "No line" and "still loading" must not look
   * alike, hence the two flags below.
   */
  standing: RankingEntry | undefined;
  ladderSize: number;
  rankingsPending: boolean;
  rankingsError: boolean;
  /** "Open a slot", when the API would actually accept it. The PAGE decides — see the page. */
  actions?: ReactNode;
};

/**
 * "Dossier" header of `/solo/$ladderId` — the counterpart of `TeamHero`, with MY identity in
 * place of the team's.
 *
 * Two deliberate differences from the team header, both from the card:
 *   - the identity is an avatar + a pseudo, not a logo + a team name;
 *   - there are THREE stats, not four. `Roster (n/10)` is gone because there is no roster:
 *     on a 1v1 ladder the player IS the side.
 *
 * The strip itself is the shared `StatStrip` (`components/ui`), so the two headers cannot
 * drift on the part that is genuinely identical.
 */
export function SoloHero({
  gameId,
  gameName,
  ladderName,
  format,
  me,
  standing,
  ladderSize,
  rankingsPending,
  rankingsError,
  actions,
}: SoloHeroProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-subtle"
    >
      {/* `GameBanner` carries the artwork AND the bottom-to-top readability gradient, and is
          `aria-hidden` by design: the game's name is written in full just below. */}
      <GameBanner gameId={gameId} name={gameName} className="h-40 sm:h-44" />

      <div className="relative -mt-14 flex flex-wrap items-end gap-4 px-4 pb-5 sm:px-6">
        <Avatar
          src={me.avatarUrl ?? undefined}
          alt=""
          fallback={me.pseudo.slice(0, 2).toUpperCase()}
          className="size-20 shrink-0 ring-4 ring-background-app"
        />
        <div className="min-w-0">
          <h1 id={headingId} className="truncate text-3xl label-caps-black sm:text-4xl">
            {me.displayName ?? me.pseudo}
          </h1>
          <p className="mt-2 text-xs label-caps text-text-secondary">
            {/* `ladderSubtitle` drops the ladder's name when it is just "<game> <format>",
                which would otherwise read "Chess · 1v1 · Chess 1v1". */}
            {[gameName, format, ladderSubtitle(ladderName, gameName, format)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {/* `ml-auto` pushes the action to the trailing edge on a wide viewport; the wrapping
            row drops it onto its own line below ~500 px instead of squeezing the pseudo. */}
        {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <StatStrip
        stats={[
          { label: 'Elo', value: standing ? String(standing.elo) : EM_DASH },
          {
            label: 'Record',
            value: standing ? formatRecord(standing.wins, standing.losses) : EM_DASH,
          },
          {
            label: 'Rank',
            value: standing ? `#${standing.rank}` : EM_DASH,
            extra: standing ? `/ ${ladderSize}` : undefined,
          },
        ]}
        note={
          rankingsError
            ? 'Ladder standings could not be loaded.'
            : !rankingsPending && !standing
              ? 'Not ranked yet — your line on this ladder is created by your first match result.'
              : undefined
        }
      />
    </section>
  );
}
