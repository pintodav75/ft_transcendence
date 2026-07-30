import { TriangleAlert, X } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { InlineButton } from '@/components/ui/inline-button';
import { LadderExcerpt } from '@/components/ladders/LadderExcerpt';
import { LinkedAccountStatus } from '@/components/solo/LinkedAccountStatus';
import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';
import { formatMatchDate } from '@/lib/match-detail';
import { nextOpenSlot, recentForm } from '@/lib/match-history';

import type { PillTone } from '@/components/ui/pill';
import type { FormResult } from '@/lib/match-history';
import type { RankingEntry } from '@/lib/ladders';
import type { RequiredProvider } from '@/lib/games';
import type { SoloMatch } from '@/lib/solo';

const formTone: Record<FormResult, PillTone> = { win: 'win', loss: 'loss', dispute: 'dispute' };
const formLetter: Record<Exclude<FormResult, 'dispute'>, string> = { win: 'W', loss: 'L' };
const formWord: Record<FormResult, string> = {
  win: 'Win',
  loss: 'Loss',
  dispute: 'Waiting for an admin decision',
};

type SoloOverviewProps = {
  meId: string;
  ladderId: string;
  ladderName: string;
  gameName: string;
  provider: RequiredProvider;
  linked: boolean | undefined;
  accountsError: boolean;
  matches: SoloMatch[] | undefined;
  /**
   * L'historique a-t-il ÉCHOUÉ ? Sans ce drapeau, « Next match » et « Last results »
   * disparaissaient **sans un mot** quand `GET /matches/me` tombait : impossible de
   * distinguer « je n'ai aucun match prévu » de « on n'a pas réussi à le charger », et
   * l'information n'était donnée que dans l'AUTRE onglet.
   */
  matchesError: boolean;
  rankings: RankingEntry[] | undefined;
  standing: RankingEntry | undefined;
  rankingsPending: boolean;
  rankingsError: boolean;
  /** Opens the confirmation for withdrawing my open slot. */
  onCancelSlot?: (match: SoloMatch) => void;
};

/**
 * Overview tab of `/solo/$ladderId` — the same four blocks as a team's Overview, with the one
 * substitution the card asked for: **the roster is replaced by my linked-account state**,
 * because that is what actually gates playing here (§5.1) and there is no roster to show.
 */
export function SoloOverview({
  meId,
  ladderId,
  ladderName,
  gameName,
  provider,
  linked,
  accountsError,
  matches,
  matchesError,
  rankings,
  standing,
  rankingsPending,
  rankingsError,
  onCancelSlot,
}: SoloOverviewProps) {
  const openSlot = matches ? nextOpenSlot(matches) : undefined;
  const form = matches ? recentForm(matches) : [];

  return (
    <div className="flex flex-col gap-8">
      <LinkedAccountStatus
        provider={provider}
        gameName={gameName}
        linked={linked}
        isError={accountsError}
      />

      <LadderExcerpt
        rankings={rankings}
        standing={standing}
        self={{ type: 'user', id: meId }}
        ladderId={ladderId}
        ladderName={ladderName}
        isPending={rankingsPending}
        isError={rankingsError}
        emptyMessage="Nobody is ranked on this ladder yet — the first finished match creates the first line."
      />

      {/* L'échec se dit ICI aussi, pas seulement dans l'onglet Matches : les deux sections
          ci-dessous sont pilotées par `matches`, et leur absence silencieuse se lit comme
          « rien de prévu, aucun résultat » — une affirmation fausse sur son propre état. */}
      {matchesError && (
        <Callout tone="muted">
          Your matches on this ladder could not be loaded, so your next match and your recent
          results are missing from this tab. The Matches tab has the details.
        </Callout>
      )}

      {openSlot && (
        <section className="flex flex-col gap-3.5">
          <SectionTitle>Next match</SectionTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border-y border-r border-l-2 border-border-subtle border-l-arena-blue bg-surface-card px-4 py-3">
            <p className="font-mono text-xs text-text-secondary">
              {formatMatchDate(openSlot.scheduledAt, 'long')}
            </p>
            <p className="text-sm text-text-muted">Waiting for an opponent</p>
            <span className="ml-auto flex items-center gap-2">
              <Pill tone="open">Open slot</Pill>
              {/* `nextOpenSlot` only ever returns a `pending` match with no opponent, so the
                  button offered here is always one the server will accept. */}
              {onCancelSlot ? (
                <InlineButton
                  tone="danger"
                  onClick={() => onCancelSlot(openSlot)}
                  aria-label={`Cancel the slot of ${formatMatchDate(openSlot.scheduledAt, 'long')}`}
                >
                  <X aria-hidden="true" className="size-3" />
                  Cancel
                </InlineButton>
              ) : null}
            </span>
          </div>
        </section>
      )}

      {form.length > 0 && (
        <section className="flex flex-col gap-3.5">
          <SectionTitle>
            Last {form.length === 1 ? 'result' : `${form.length} results`}
          </SectionTitle>
          <ul role="list" className="flex flex-wrap gap-1.5">
            {form.map((entry) => (
              <li key={entry.id}>
                <Pill tone={formTone[entry.result]} title={formWord[entry.result]}>
                  {entry.result === 'dispute' ? (
                    <TriangleAlert aria-hidden="true" className="size-3.5" />
                  ) : (
                    <span aria-hidden="true">{formLetter[entry.result]}</span>
                  )}
                  <span className="sr-only">{formWord[entry.result]}</span>
                </Pill>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
