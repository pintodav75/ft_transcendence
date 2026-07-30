import { ArrowLeft, Trophy } from 'lucide-react';
import { Link, useParams, useRouterState } from '@tanstack/react-router';

import { GameBanner } from '@/components/games/GameBanner';
import { LadderBoard } from '@/components/ladders/LadderBoard';
import { LadderMapPool } from '@/components/ladders/LadderMapPool';
import { LadderRules } from '@/components/ladders/LadderRules';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';
import { backLinkClasses } from '@/lib/back-navigation';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { isValidLadderId, useLadder, useLadderRankings } from '@/lib/ladders';
import { useMyTeams } from '@/lib/teams';

/**
 * The single segment following `prefix` in `path`, when there is exactly one.
 *
 * ⚠️ The guard on `includes('/')` is what keeps a deeper path (`/games/cs2/whatever`) from
 * being fed to a route that takes ONE param.
 */
function segmentAfter(path: string | undefined, prefix: string) {
  if (!path?.startsWith(prefix)) return undefined;

  const segment = path.slice(prefix.length);
  return segment.length > 0 && !segment.includes('/') ? segment : undefined;
}

/**
 * Where "back" actually leads, read from the history entry.
 *
 * 🔑 A browser never tells a page what is behind it, so the origin is written into the history
 * entry by the link that was clicked (`state={useBackFrom()}`, see `lib/back-navigation.ts`).
 * Reading it here is what stops this page from claiming "Back to my teams" to someone who
 * arrived from `/games/cs2` or from a match sheet — and who may well have no team at all.
 *
 * 🚨 THIS PAGE HAS FOUR INBOUND LINKS, and the label must hold for each. `GameLadderCard` and
 * the match sheet record their origin, so they get a truthful label; `LadderExcerpt` (a team
 * page) records none, and its fallback "Back to my teams" is already true. The fourth,
 * `solo-ladder.tsx`, DELIBERATELY records none: that link only exists on its "Not a solo
 * ladder" panel, so sending the visitor "back" would return them to an error screen —
 * "Back to my teams" is the better answer on a ladder played with a squad.
 *
 * ⚠️ The recorded origin is a PATH, never a name: naming the game would mean fetching it just
 * to label a button (same decision as `BackButton`'s `backLabel`).
 */
function useBackDestination() {
  const backFrom = useRouterState({ select: (state) => state.location.state.backFrom });

  const gameId = segmentAfter(backFrom, '/games/');
  if (gameId) return { kind: 'game', gameId } as const;

  const matchId = segmentAfter(backFrom, '/matches/');
  if (matchId) return { kind: 'match', matchId } as const;

  return { kind: 'teams' } as const;
}

/**
 * The way back up. Falls back — UNCHANGED — on "Back to my teams" whenever the history entry
 * carries no origin: a pasted link, a fresh tab, or an arrival from a team page.
 */
function BackUp({ variant = 'button' }: { variant?: 'inline' | 'button' }) {
  const destination = useBackDestination();
  const inline = variant === 'inline';
  const className = inline ? backLinkClasses : buttonClasses('secondary');
  const icon = <ArrowLeft aria-hidden="true" className={inline ? 'size-4' : 'mr-2 size-4'} />;

  if (destination.kind === 'game') {
    return (
      <Link to="/games/$gameId" params={{ gameId: destination.gameId }} className={className}>
        {icon}
        Back to the game
      </Link>
    );
  }

  if (destination.kind === 'match') {
    return (
      <Link to="/matches/$matchId" params={{ matchId: destination.matchId }} className={className}>
        {icon}
        Back to the match
      </Link>
    );
  }

  return (
    <Link to="/teams" className={className}>
      {icon}
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
          <BackUp />
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
            <BackUp />
          </ErrorPanel>
        ) : (
          <ErrorPanel
            title="Ladder unavailable"
            message="This ladder could not be loaded. Check your connection and reload the page."
          >
            <BackUp />
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
      {/* The 4th place the way back up is rendered — the three others are the dead-end panels
          above. All four read the same origin, so none of them can drift into a lie on its
          own. */}
      <BackUp variant="inline" />

      <div className="panel flex min-w-0 flex-col gap-8 p-6">
        <header className="space-y-1">
          {/* Artwork du jeu, même idiome que `TeamHero` : bandeau + dégradé de lisibilité
              bas-haut. ⚠️ Les 3 lignes sont passées dans `GameBanner` quand la page match en
              a eu besoin (FT-4A, règle du second usage) — le dégradé n'est plus recopié. */}
          <GameBanner
            gameId={game.id}
            name={game.name}
            className="-mx-6 -mt-6 mb-4 h-32 sm:h-36"
          />
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
              self={myTeamOnThisLadder ? { type: 'team', id: myTeamOnThisLadder.id } : undefined}
              selfNote="(your team)"
            />
          )}
        </section>
      </div>
    </div>
  );
}
