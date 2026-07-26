// Game + ladder picker, controlled by the parent.
//
// Options:
//   mode="ladder" (default) — pick a game then a format; emits a ladder id.
//   mode="game"             — pick a game only, no format row; emits a game id.
//   excludeSolo             — (ladder mode) drop 1v1 ladders and games with none.
//   all                     — add an "All" button; picking it emits '' (no filter).

import { useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

import type { components } from '@/lib/api-types.gen';

type Ladder = components['schemas']['Ladder'];
type Game = components['schemas']['Game'];

type LadderSelectProps = {
  value: string | undefined;
  // Add an "All" button; selecting it emits '' (empty filter) and is the default.
  all?: boolean;
  // Restrict the game buttons to this subset of game ids — used by a filter bar
  // over an existing collection ("my teams"), where offering a game the user
  // owns nothing in can only lead to an empty list. Omitted = every game.
  // "All" is never affected: it shows even when this is empty.
  gameIds?: string[];
} & (
  | {
      // Default: pick a game, then a format inside it. `excludeSolo` drops 1v1
      // ladders and any game left with none (POST /teams rejects solo with a 400).
      mode?: 'ladder';
      onChange: (ladderId: string | undefined) => void;
      excludeSolo?: boolean;
    }
  | {
      // Pick a game only: no format row, emits the game id.
      mode: 'game';
      onChange: (gameId: string | undefined) => void;
      excludeSolo?: boolean;
    }
);

export function LadderSelect(props: LadderSelectProps) {
  const { value, onChange, all = false, gameIds } = props;
  const onlyGame = props.mode === 'game';
  const excludeSolo = props.excludeSolo;
  const [games, setGames] = useState<Game[]>([]);
  const [ladders, setLadders] = useState<Ladder[]>([]);
  const [gameId, setGameId] = useState<string>();
  const [error, setError] = useState<string>();

  // Read onChange through a ref so the fetch below never re-runs because the
  // parent re-rendered with a fresh arrow function.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Both lists are small and static, so fetch them once and filter in memory
  // rather than re-querying /ladders on every game change.
  useEffect(() => {
    Promise.all([
      apiFetch<{ games: Game[] }>('/games'),
      apiFetch<{ ladders: Ladder[] }>('/ladders'),
    ])
      .then(([gamesResponse, laddersResponse]) => {
        const usableLadders = excludeSolo
          ? laddersResponse.ladders.filter((ladder) => ladder.format !== '1v1')
          : laddersResponse.ladders;
        const playableGames = gamesResponse.games.filter((game) =>
          usableLadders.some((ladder) => ladder.gameId === game.id),
        );

        const firstGameId = playableGames[0]?.id;
        setLadders(usableLadders);
        setGames(playableGames);

        // With `all`, default to the "All" option: no game highlighted, empty filter.
        if (all) {
          setGameId(undefined);
          onChangeRef.current('');
          return;
        }
        setGameId(firstGameId);
        onChangeRef.current(
          onlyGame ? firstGameId : usableLadders.find((l) => l.gameId === firstGameId)?.id,
        );
      })
      .catch(() => setError('Could not load games and ladders.'));
  }, [excludeSolo, onlyGame, all]);

  const gameLadders = useMemo(
    () => ladders.filter((ladder) => ladder.gameId === gameId),
    [ladders, gameId],
  );

  // Narrowed here rather than in the fetch above: `gameIds` usually comes from
  // a query that resolves after this one, so the list has to re-narrow on every
  // render instead of once. Four games — filtering them costs nothing.
  const shownGames = gameIds ? games.filter((game) => gameIds.includes(game.id)) : games;

  function selectGame(nextGameId: string) {
    setGameId(nextGameId);
    onChange(onlyGame ? nextGameId : ladders.find((ladder) => ladder.gameId === nextGameId)?.id);
  }

  // "All" clears the game selection and emits '' so the parent stops filtering.
  function selectAll() {
    setGameId(undefined);
    onChange('');
  }

  // Shared styling for the buttons.
  const optionClass = (active: boolean, big_text = false) =>
    cn(
      'rounded-control border px-4 py-2 label-caps transition focus-ring ',
      active
        ? 'border-action-primary bg-action-primary text-action-primary-foreground'
        : 'border-border-subtle bg-surface-card-strong text-text-secondary hover:text-text-primary',
      big_text ? 'text-lg' : 'text-xs',
    );

  if (error) {
    return (
      <p className="text-sm text-arena-red" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {all && (
          <button
            type="button"
            onClick={selectAll}
            aria-pressed={gameId === undefined}
            className={optionClass(gameId === undefined, true)}
          >
            All
          </button>
        )}
        {shownGames.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => selectGame(game.id)}
            aria-pressed={game.id === gameId}
            className={optionClass(game.id === gameId, true)}
          >
            {game.name}
          </button>
        ))}
      </div>

      {/* Shown from a single ladder up: even with only one format (e.g. LoL's
          5v5), the user must see which ladder their team is being created on. */}
      {!onlyGame && gameLadders.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {gameLadders.map((ladder) => (
            <button
              key={ladder.id}
              type="button"
              onClick={() => onChange(ladder.id)}
              aria-pressed={ladder.id === value}
              className={optionClass(ladder.id === value)}
            >
              {ladder.format}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LadderSelect;
