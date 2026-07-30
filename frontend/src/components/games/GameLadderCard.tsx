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
 * 🔑 THE RECIPE IS THE DESIGN SYSTEM'S, NOT AN INVENTION — `border-<token>/40 bg-<token>/10
 * text-<token>` is exactly what `ui/pill.tsx` applies to all seven of its tones, and its
 * `live` tone is already `rank-gold` in those very proportions. Two earlier attempts failed
 * for the same underlying reason: the lucide `Medal` (disc + ribbon) is a thin outline, so at
 * 16 px there were too few tinted pixels for gold (#d9a441) to read against bronze (#bf7145);
 * and a fully opaque disc read as a sticker, because it was the only flat solid on a screen
 * built entirely from dark chips with a discreet border. Here the colour sits on the border
 * AND on the figure, which is what makes it carry without shouting.
 *
 * 🚨 COLOUR CARRIES NOTHING ON ITS OWN. The rank is printed inside the chip and an `sr-only`
 * spells the place out in words: a gold round means nothing to a screen reader, and little to
 * a colour-blind visitor.
 *
 * ⚠️ MEASURED contrast of the figure over its own tinted chip on `surface-card`: gold 8.0:1,
 * silver 11.4:1, bronze **4.3:1** — the last one is a hair under the 4.5:1 floor, same family
 * as the repo's known `text-text-muted` debt (4.23:1, design-system ticket). It is a FIGURE
 * that is also given by the row's position and by the `sr-only` label, so nothing is lost by
 * it — but lightening `--color-rank-bronze` is the real fix, and it belongs to that ticket.
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

/**
 * One podium line: medal, rank, competitor, Elo.
 *
 * ⚠️ A competitor is POLYMORPHIC (`user` on a 1v1 ladder, `team` from 2v2 up) — hence
 * `competitorName`/`competitorAvatarUrl` rather than reading `.name` or `.pseudo`, and hence
 * two different destinations for the link.
 */
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
          // `Pill`'s own `muted` tone. Unreachable while the podium is three rows, and that is
          // precisely why it must not invent a fourth colour.
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
          // A player page has no parent of its own: it names its "back" from the history
          // entry, so every link into it has to say where it came from.
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
        {/* The column header above is `aria-hidden`, so the unit has to travel with the
            figure: a screen reader was reading "First place, Team Alpha, 1328". */}
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

/**
 * One ladder of a game: who is on top, where I stand, and the way in.
 *
 * 🚨 THE CARD NEVER DECIDES ANYTHING FROM THE ABSENCE OF A TEAM. Its action is handed to it,
 * computed from `ladder.format` — the trap that has already cost two fixes in this repo
 * (FT-4A, F-SOLO): a missing team means "you have no team here", never "this is solo".
 *
 * ⚠️ The podium is an EXCERPT whose job is to make you click through. The rules, the map pool
 * and the WHOLE board live on `/ladders/$ladderId` (FT-3) — repeating them here would be a
 * second copy of a page that already exists.
 */
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
        {/* §5.2 — the window a side is locked for around a match, in plain sight before you
            commit to a ladder. */}
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
          {/* Naming the column: three bare figures on the right told nobody they were Elo.
              `aria-hidden` because this is not a `<table>` — the header cell is associated
              with nothing, so each row spells its own unit out (see `PodiumRow`). Same
              division of labour as `LadderRowHeader` on the full board. */}
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
