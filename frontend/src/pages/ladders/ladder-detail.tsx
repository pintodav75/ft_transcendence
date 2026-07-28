import { Trophy } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { GameImage } from '@/components/games/GameImage';
import { LadderBoard } from '@/components/ladders/LadderBoard';
import { LadderMapPool } from '@/components/ladders/LadderMapPool';
import { LadderRules } from '@/components/ladders/LadderRules';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { isValidLadderId, useLadder, useLadderRankings } from '@/lib/ladders';
import { useMyTeams } from '@/lib/teams';

function BackToTeams() {
  return (
    <Link to="/teams" className={buttonClasses('secondary')}>
      Back to my teams
    </Link>
  );
}

// Destination of the "See the full ladder" link of a team page: the ladder's identity, the
// rules that actually govern a match on it, the map pool, and the WHOLE standings (the
// excerpt only ever shows five rows around one team).
export function LadderDetail() {
  const { ladderId } = useParams({ from: '/_authenticated/ladders/$ladderId' });

  // Déjà en cache quand on arrive depuis /teams ou depuis une page équipe : TanStack partage
  // la clé ['teams'], cette ligne ne coûte donc une requête que sur une arrivée par URL.
  const myTeams = useMyTeams();

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so
  // the error state is rendered without spending a request — and without the red "Failed to
  // load resource" line that request would leave in the console.
  const validId = isValidLadderId(ladderId);

  const ladderQuery = useLadder(ladderId, validId);
  // Fired in PARALLEL with the ladder, not after it: the standings are the bulk of this
  // page, and chaining them behind a first round-trip would double the wait for the common
  // case. `undefined` keeps the hook disabled while the id is malformed.
  const rankingsQuery = useLadderRankings(validId ? ladderId : undefined);

  const rankings = rankingsQuery.data?.rankings;

  if (!validId) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Invalid ladder link"
          message="This ladder identifier is not a valid id. Check the link you followed, or open the ladder from one of your teams."
        >
          <BackToTeams />
        </ErrorPanel>
      </div>
    );
  }

  if (ladderQuery.isError) {
    const status = ladderQuery.error instanceof ApiError ? ladderQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 404 ? (
          <ErrorPanel
            title="Ladder not found"
            message="No ladder answers to this link. Ladders are seeded with the games, so this one has most likely never existed."
          >
            <BackToTeams />
          </ErrorPanel>
        ) : (
          <ErrorPanel
            title="Ladder unavailable"
            message="This ladder could not be loaded. Check your connection and reload the page."
          >
            <BackToTeams />
          </ErrorPanel>
        )}
      </div>
    );
  }

  if (!ladderQuery.data) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {/* Same footprint as the loaded panel so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        {/* THE live region of this screen — there must only ever be one, and no other
            element below carries `role="status"`. */}
        <p role="status" className="text-sm text-text-muted">
          Loading the ladder…
        </p>
      </div>
    );
  }

  const { ladder, game, maps } = ladderQuery.data;

  // Se retrouver dans un classement complet : on arrive ici depuis SA page équipe et sans
  // repère la ligne se perd dans la liste. `LadderBoard` sait déjà surligner (l'extrait s'en
  // sert), il lui manquait juste l'id.
  // ⚠️ Un joueur a AU PLUS une équipe par ladder (contrainte `team_members_user_ladder_unique`),
  // donc un `find` suffit — il n'y a pas d'ambiguïté à arbitrer.
  const myTeamOnThisLadder = myTeams.data?.teams.find((team) => team.ladderId === ladder.id);

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <div className="panel flex min-w-0 flex-col gap-8 p-6">
        <header className="space-y-1">
          {/* Artwork du jeu, même idiome que `TeamHero` : bandeau + dégradé de lisibilité
              bas-haut. On réutilise `GameImage` (et son repli quand l'asset manque), on ne
              recopie pas ses classes. `aria-hidden` sur le bloc : le nom du jeu est déjà
              écrit en toutes lettres juste dessous, l'image est décorative. */}
          <div aria-hidden="true" className="relative -mx-6 -mt-6 mb-4 h-32 overflow-hidden sm:h-36">
            <GameImage gameId={game.id} name={game.name} className="size-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-background-app via-background-app/55 to-transparent" />
          </div>
          <p className="flex items-center gap-2 text-xs label-caps text-success">
            <Trophy aria-hidden="true" className="size-4" /> Ladder
          </p>
          <h1 className="text-3xl label-caps-black">{ladder.name}</h1>
          <p className="flex flex-wrap items-center gap-2 pt-1 text-xs label-caps text-text-secondary">
            <span>{game.name}</span>
            <Pill tone="muted">{ladder.format}</Pill>
            {/* Silent while the standings load: "0 ranked" would be a claim, not a
                placeholder. */}
            {rankings && (
              <span>
                {rankings.length} ranked {rankings.length === 1 ? 'competitor' : 'competitors'}
              </span>
            )}
          </p>
        </header>

        <LadderRules ladder={ladder} game={game} />

        {/* An empty pool is NOT an error: lol, rl and chess simply have no maps. */}
        {maps.length > 0 && <LadderMapPool maps={maps} gameName={game.name} />}

        <section className="flex min-w-0 flex-col gap-3.5">
          <SectionTitle>Standings</SectionTitle>

          {rankingsQuery.isPending && (
            <p className="text-sm text-text-muted">Loading the standings…</p>
          )}

          {rankingsQuery.isError && (
            <p className="text-sm text-text-secondary">
              The standings could not be loaded. Reload the page to try again.
            </p>
          )}

          {rankings && rankings.length === 0 && (
            <p className="max-w-prose text-sm text-text-secondary">
              No competitor is ranked on this ladder yet — a line is created by a first match
              result, not by creating a team.
            </p>
          )}

          {rankings && rankings.length > 0 && (
            <LadderBoard
              entries={rankings}
              selfTeamId={myTeamOnThisLadder?.id}
              selfNote="(your team)"
            />
          )}
        </section>
      </div>
    </div>
  );
}
