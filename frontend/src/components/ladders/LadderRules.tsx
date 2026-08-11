import { SectionTitle } from '@/components/ui/section-title';
import { providerLabel } from '@/lib/games';
import { MIN_LEAD_MINUTES, SLOT_GRID_MINUTES, MAX_OPEN_SLOTS } from '@/lib/match-slots';

import type { ReactNode } from 'react';
import type { Ladder, LadderGame } from '@/lib/ladders';

/**
 * Product constants the API does not expose, each with the file that owns them server-side so
 * the screen can be checked against it:
 *   - WINS_REQUIRED / K_FACTOR -> backend/src/utils/elo.ts (Bo3 everywhere, no per-ladder override)
 *   - STARTING_ELO             -> backend/src/db/schema.ts, rankings.elo default
 *   - AUTO_CONFIRM_HOURS       -> backend/src/jobs/index.ts, CONFIRM_TIMEOUT_MS
 * slot bounds come from lib/match-slots.ts, already a mirror of backend/src/routes/matches.ts.
 *
 * move any of these and it moves in TWO places. a rules screen that lies is worse than none.
 */
const WINS_REQUIRED = 2;
const STARTING_ELO = 1000;
const K_FACTOR = 32;
const AUTO_CONFIRM_HOURS = 24;

type RuleProps = {
  term: string;
  value: string;
  children: ReactNode;
};

function Rule({ term, value, children }: RuleProps) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface-card px-4 py-3">

      <dt className="text-xs label-caps text-text-secondary">{term}</dt>
      <dd className="mt-1 flex flex-col gap-1">
        <span className="font-mono text-base font-bold tabular-nums text-text-primary">
          {value}
        </span>
        <span className="text-xs text-text-secondary">{children}</span>
      </dd>
    </div>
  );
}

type LadderRulesProps = {
  ladder: Ladder;
  game: LadderGame;
};

export function LadderRules({ ladder, game }: LadderRulesProps) {
  // "5v5" -> "5". The format is a closed union in the contract, so the split cannot fail.
  const perSide = ladder.format.split('v')[0];
  const provider = providerLabel(game.requiredProvider);

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Rules</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        A side opens a slot at a time of its choosing and another side accepts it — you pick
        your opponent and your kick-off. Both sides then enter the score, and the Elo of this
        ladder moves.
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Rule term="Slot" value={`${SLOT_GRID_MINUTES}-min grid`}>
          Kick-off must land on a fixed {SLOT_GRID_MINUTES}-minute mark and sit at least{' '}
          {MIN_LEAD_MINUTES} minutes away. The same bound applies to opening a slot and to
          accepting one.
        </Rule>

        <Rule term="Format" value={ladder.format}>
          {perSide} player{perSide === '1' ? '' : 's'} a side, fielded from the roster for that
          match.
        </Rule>

        <Rule term="Series" value="Best of 3">
          The first side to {WINS_REQUIRED} map wins takes the match — every ladder, every
          game.
        </Rule>

        <Rule term="Rating" value={`Elo · K ${K_FACTOR}`}>
          A competitor enters the board at {STARTING_ELO} on its first result and each match
          moves both sides by up to {K_FACTOR} points.
        </Rule>

        <Rule term="Lockout" value={`${ladder.lockoutMinutes} min`}>
          A side already engaged at a given time cannot take a second slot within{' '}
          {ladder.lockoutMinutes} minutes of it, before or after. Two matches that merely
          touch are fine.
        </Rule>

        <Rule term="Linked account" value={provider}>
          A player can only be fielded once their {provider} account is linked on their
          profile.
        </Rule>

        <Rule term="Score" value={`${AUTO_CONFIRM_HOURS} h`}>
          A result can be entered once the scheduled time has passed. Left unanswered it is
          confirmed automatically after {AUTO_CONFIRM_HOURS} h; a match nobody reports is
          cancelled after the same delay.
        </Rule>

        <Rule term="Disagreement" value="Admin ruling">
          If the two sides report a different winner — or the same winner with a different
          score, 2-0 against 2-1 — a dispute opens by itself and an admin settles it. Neither
          Elo moves until the ruling.
        </Rule>

        <Rule term="Unclaimed slot" value={`${MIN_LEAD_MINUTES} min`}>
          A slot nobody accepted is cancelled once it comes within {MIN_LEAD_MINUTES} minutes
          of its own kick-off, and gives its side back one of its {MAX_OPEN_SLOTS} open slots.
        </Rule>
      </dl>
    </section>
  );
}
