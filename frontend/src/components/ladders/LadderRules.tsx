import { SectionTitle } from '@/components/ui/section-title';
import { providerLabel } from '@/lib/games';
// Les trois bornes du créneau vivent déjà ici (elles pilotent le sélecteur de
// `CreateMatchPanel`) : on les IMPORTE plutôt que d'en recopier la valeur. Un écran de règles
// qui ment est pire que pas d'écran de règles, et une constante dupliquée ment tôt ou tard.
// ⚠️ Elles ne sont pas propres au domaine « équipe » malgré le nom du fichier — candidates à
// un `lib/match-rules.ts` le jour où un troisième consommateur apparaît.
import { MIN_LEAD_MINUTES, SLOT_GRID_MINUTES, MAX_OPEN_SLOTS } from '@/lib/match-slots';

import type { ReactNode } from 'react';
import type { Ladder, LadderGame } from '@/lib/ladders';

/**
 * Product constants the API does NOT expose, written here with the file that owns them so a
 * reader can check the screen against the server:
 *   - `WINS_REQUIRED` / `K_FACTOR`  -> backend/src/utils/elo.ts (Bo3 for every ladder, no
 *     per-ladder override: the same decision the score routes enforce);
 *   - `STARTING_ELO`               -> backend/src/db/schema.ts, `rankings.elo` default;
 *   - `AUTO_CONFIRM_HOURS`         -> backend/src/jobs/index.ts, `CONFIRM_TIMEOUT_MS`, which
 *     is also the delay after which a match nobody reported is abandoned.
 * Les bornes du créneau (`SLOT_GRID_MINUTES`, `MIN_LEAD_MINUTES`, `MAX_OPEN_SLOTS`) sont
 * importées de `lib/team-detail` : elles y sont déjà le miroir de
 * `backend/src/routes/matches.ts:33,37,41`.
 * ⚠️ If one of them ever moves, it moves in TWO places. A rules screen that lies is worse
 * than no rules screen — hence the file references above rather than a bare number.
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
      {/* `text-text-secondary`, PAS `text-text-muted` : le muted tombe à 4,23:1 sur une
          carte (sous AA) et c'est une dette déjà ticketée — on ne l'agrandit pas de six
          libellés porteurs. */}
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

      {/* 🚨 Challenge / accept, and nothing else. This platform has NO queue and NO
          automatic pairing by rating (product decision, 13/07): wording that hinted at
          either would promise a screen that does not exist. */}
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

        {/* Le déclencheur est plus large que « pas le même vainqueur » : deux camps qui
            désignent le même vainqueur avec un score différent (2-0 contre 2-1) partent
            aussi en litige. Le dire, sinon un joueur croit qu'approximer le score est sans
            conséquence. */}
        <Rule term="Disagreement" value="Admin ruling">
          If the two sides report a different winner — or the same winner with a different
          score, 2-0 against 2-1 — a dispute opens by itself and an admin settles it. Neither
          Elo moves until the ruling.
        </Rule>

        {/* ⚠️ PAS 24 h (ce que dit la carte Trello) : `cancelExpiredSlots` annule tout slot
            `pending` dès qu'il passe sous MIN_LEAD_MINUTES de son PROPRE coup d'envoi —
            l'instant précis où plus personne ne peut l'accepter. Les 24 h de la règle
            « Score » ci-dessus sont un autre mécanisme (match joué mais non rapporté). */}
        <Rule term="Unclaimed slot" value={`${MIN_LEAD_MINUTES} min`}>
          A slot nobody accepted is cancelled once it comes within {MIN_LEAD_MINUTES} minutes
          of its own kick-off, and gives its side back one of its {MAX_OPEN_SLOTS} open slots.
        </Rule>
      </dl>
    </section>
  );
}
