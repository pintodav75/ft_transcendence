import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { buttonClasses } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';
import { competitorAvatarUrl, competitorName } from '@/lib/ladders';
import { useBackFrom } from '@/lib/back-navigation';

import type { ReactNode } from 'react';
import type { RankingEntry } from '@/lib/ladders';
import type { Ladder } from '@/lib/games';

/**
 * The podium medal: a round chip, one per rank.
 *
 * `border-<token>/40 bg-<token>/10 text-<token>` is the recipe ui/pill.tsx uses for all its
 * tones, colour on the border AND on the figure so it carries at 16 px.
 * colour carries nothing on its own: the rank is printed in the chip and an sr-only spells the
 * place out in words.
 * contrast of the figure on its chip: gold 8.0:1, silver 11.4:1, bronze 4.3:1 — bronze is just
 * under the 4.5:1 floor, lightening --color-rank-bronze is the real fix.
 */
const medalClasses: Record<number, string> = {
  1: 'border-rank-gold/40 bg-rank-gold/10 text-rank-gold',
  2: 'border-rank-silver/40 bg-rank-silver/10 text-rank-silver',
  3: 'border-rank-bronze/40 bg-rank-bronze/10 text-rank-bronze',
};

const placeLabels: Record<number, string> = {
  1: 'First place',
  2: 'Second place',
  3: 'Third place',
};

/** One podium line: medal, rank, competitor, Elo. */
function PodiumRow({ entry }: { entry: RankingEntry }) {
  const backFrom = useBackFrom();
  const name = competitorName(entry.competitor);
  const nameClasses = 'focus-ring truncate rounded-control font-bold hover:text-text-primary';

  return (
    <li className="flex items-center gap-2.5 text-sm">
      {/* The place in words for a screen reader, the figure on the disc for everyone else. */}
      <span className="sr-only">{placeLabels[entry.rank] ?? `Rank ${entry.rank}`}</span>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold tabular-nums',
          // Beyond the third there is no medal, so the chip falls back to the neutral one —
          // `Pill`'s own `muted` tone.
          medalClasses[entry.rank] ?? 'border-border-subtle bg-surface-input text-text-muted',
        )}
      >
        {entry.rank}
      </span>

      <Avatar
        src={competitorAvatarUrl(entry.competitor)}
        alt=""
        fallback={name.slice(0, 2).toUpperCase()}
        className="size-7 shrink-0"
      />

      {entry.competitor.type === 'user' ? (
        <Link
          to="/players/$pseudo"
          params={{ pseudo: entry.competitor.pseudo }}
          // A player page has no parent of its own: it names its "back" from the history entry,
          // so every link into it has to say where it came from.
          state={backFrom}
          className={nameClasses}
        >
          {name}
        </Link>
      ) : (
        <Link to="/teams/$teamId" params={{ teamId: entry.competitor.id }} className={nameClasses}>
          {name}
        </Link>
      )}

      <span className="ml-auto shrink-0 font-mono font-bold tabular-nums">

        <span className="sr-only">Elo </span>
        {entry.elo}
      </span>
    </li>
  );
}

type GameLadderCardProps = {
  ladder: Ladder;
  /** Top three of `GET /ladders/{id}/rankings`, sliced by the caller. */
  podium: RankingEntry[];
  /** `false` while the standings load or if they failed — the podium then says why. */
  podiumLoaded: boolean;
  podiumFailed: boolean;
  /** My line on this ladder, in words: an Elo, "Not ranked yet", or why it is unknown. */
  standingLabel: string;
  /** The one action of the card, decided by the FORMAT — see `GameLadderCards`. */
  action: ReactNode;
};

/** One ladder of a game: who is on top, where I stand, and the way in. */
export function GameLadderCard({
  ladder,
  podium,
  podiumLoaded,
  podiumFailed,
  standingLabel,
  action,
}: GameLadderCardProps) {
  const backFrom = useBackFrom();

  return (
    <li className="flex flex-col gap-3.5 rounded-control border border-border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg label-caps-black">{ladder.name}</h3>
        <Pill tone="muted">{ladder.format}</Pill>

        <span className="text-xs label-caps text-text-muted">
          {ladder.lockoutMinutes} min lockout
        </span>
      </div>

      {podiumFailed && (
        <p className="text-sm text-text-secondary">
          The standings could not be loaded. Reload the page to try again.
        </p>
      )}

      {!podiumLoaded && !podiumFailed && <p className="text-sm text-text-muted">Loading the top…</p>}

      {podiumLoaded && podium.length === 0 && (
        <p className="max-w-prose text-sm text-text-secondary">
          No one ranked yet — a line is created by a first match result, not by joining.
        </p>
      )}

      {podium.length > 0 && (
        <div className="flex flex-col gap-2">

          <p aria-hidden="true" className="text-right text-xs label-caps text-text-muted">
            Elo
          </p>
          <ol role="list" className="flex flex-col gap-2">
            {podium.map((entry) => (
              <PodiumRow key={`${entry.competitor.type}-${entry.competitor.id}`} entry={entry} />
            ))}
          </ol>
        </div>
      )}

      <p className="text-xs label-caps text-text-secondary">{standingLabel}</p>

      <div className="flex flex-wrap items-center gap-4">
        {action}
        <Link
          to="/ladders/$ladderId"
          params={{ ladderId: ladder.id }}
          // The ladder page hard-coded "Back to my teams"; arriving from a game, that was a
          // lie. It reads this origin instead.
          state={backFrom}
          className={buttonClasses('ghost')}
        >
          See the full standings
        </Link>
      </div>
    </li>
  );
}
