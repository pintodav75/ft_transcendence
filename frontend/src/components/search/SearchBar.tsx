// Searchbar UI component. it does a PREFIX search over players and teams, backed by `GET
// /search?...`.

import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import { useGameByLadder } from '@/lib/games';

import { DefaultRowRender } from './DefaultRowRender';

import { Fragment, type ReactNode } from 'react';
import type { paths } from '@/lib/api-types.gen';

type SearchResponse = paths['/search']['get']['responses'][200]['content']['application/json'];
export type SearchResult = SearchResponse['results'][number];
export type SearchBarProps = {
  // to use a different row component
  renderResult?: (result: SearchResult) => ReactNode;

  // search options
  type?: 'user' | 'team'; // null = search for both
  limit?: number;
  excludeIds?: string[]; // ids to filter out (eg. blocked users)

  // appearence option
  panel?: 'overlay' | 'inline'; // have the panel float or overlay
  small?: boolean;
  placeholder?: string; // text inside empty searchbar

  // interactivity, not used if you have your own row component
  onSelect?: (result: SearchResult) => void;
  disabled?: boolean; // condition for should it be disabled or not.

  // accessibility
  label?: string; // aria-label du champ. Fallback to placeholder.
  announce?: (message: string) => void; // callback if the caller already has an announce
};

const DEBOUNCE_MS = 300;
// Reprend les bornes du back (`q` trimmé, 2 à 50 — routes/search.ts). Hors bornes = 400
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 50;
const RESULT_LIMIT = 10;

function isSearchableQuery(value: string): boolean {
  const length = value.trim().length;
  return length >= MIN_QUERY_LENGTH && length <= MAX_QUERY_LENGTH;
}

function defaultPlaceholder(type: SearchBarProps['type']): string {
  if (type === 'user') return 'Search a player by pseudo…';
  if (type === 'team') return 'Search a team by name…';
  return 'Search a player or team…';
}

type PanelState =
  | { kind: 'too-short' }
  | { kind: 'searching' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'results'; results: SearchResult[] };

// this return the state the panel is
function getPanelState(input: {
  tooShort: boolean;
  loading: boolean;
  error?: string;
  results: SearchResult[] | null;
  visible: SearchResult[];
}): PanelState | null {
  const { tooShort, loading, error, results, visible } = input;

  if (tooShort) return { kind: 'too-short' };

  // we check this first, if theres already results we dont display 'searching', we just keep
  // showing the old result (instead of a blinking 'searching...')
  if (!error && results !== null) {
    return visible.length > 0 ? { kind: 'results', results: visible } : { kind: 'empty' };
  }
  // Une erreur remet `results` à `null` (voir le `catch` de l'effet) : retaper repart donc en «
  // Searching… », et le message d'erreur ne survit que tant que rien n'est reparti.
  if (loading) return { kind: 'searching' };
  if (error) return { kind: 'error', message: error };

  return null;
}

export function SearchBar({
  type,
  limit = RESULT_LIMIT,
  small = false,
  onSelect,
  renderResult,
  placeholder,
  label,
  excludeIds,
  disabled = false,
  announce,
  panel = 'overlay',
}: SearchBarProps) {
  const navigate = useNavigate();
  const fieldId = useId();
  const [query, setQuery] = useState('');
  // `null` = no result yet `[]` = server answered with no result.
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // calls the announce callback if given
  useEffect(() => {
    if (loading && isSearchableQuery(query)) announce?.('Searching…');
  }, [announce, loading, query]);

  const containerRef = useRef<HTMLDivElement>(null); // used to close on outside click
  const latestRequest = useRef(0); // prevent race from responses
  const fieldPlaceholder = placeholder ?? defaultPlaceholder(type);
  // PRÉCHARGEMENT de la table ladder->jeu
  const gameByLadder = useGameByLadder({ enabled: type !== 'user' && isSearchableQuery(query) });

  function defaultSelect(result: SearchResult) {
    if (result.type === 'team') {
      navigate({ to: '/teams/$teamId', params: { teamId: result.id } });
    } else {
      navigate({ to: '/players/$pseudo', params: { pseudo: result.pseudo } });
    }
    setQuery('');
  }
  const handleSelect = onSelect ?? defaultSelect;

  // the effect of the changing the query
  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const trimmed = query.trim();

      if (!isSearchableQuery(query)) {
        setResults(null);
        setError(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
      if (type) params.set('type', type);

      apiFetch<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal })
        .then(({ results: found }) => {
          if (requestId !== latestRequest.current) return; // keep only the latest req
          setResults(found);
          setError(undefined);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted || requestId !== latestRequest.current) return;
          setError(searchError instanceof ApiError ? searchError.message : 'Search failed.');
          setResults(null);
        })
        .finally(() => {
          if (requestId === latestRequest.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    // cleanup func, dont forget to abort an ongoing request
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, type, limit]);

  // calc the panel state:
  const trimmed = query.trim();
  const istooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const visibleResults = results
    ? excludeIds
      ? results.filter((result) => !excludeIds.includes(result.id))
      : results
    : [];
  const panelState = getPanelState({
    tooShort: istooShort,
    loading,
    error,
    results,
    visible: visibleResults,
  });

  // Fermeture EXPLICITE du panneau.
  const [dismissed, setDismissed] = useState(false); // explicit closing ( we cant guess it from input text alone)
  const showPanel = trimmed.length > 0 && !dismissed;

  // Fermeture au clic extérieur.
  const dismissEvent = panel === 'inline' ? 'click' : 'pointerdown';

  useEffect(() => {
    if (!showPanel) return;

    function dismissOnOutside(event: Event) {
      if (!containerRef.current?.contains(event.target as Node)) setDismissed(true);
    }

    document.addEventListener(dismissEvent, dismissOnOutside);
    return () => document.removeEventListener(dismissEvent, dismissOnOutside);
  }, [dismissEvent, showPanel]);

  return (
    <div ref={containerRef} className="relative w-full">
      {!announce && (
        <p role="status" className="sr-only">
          {loading && isSearchableQuery(query) ? 'Searching…' : ''}
        </p>
      )}

      <Input
        id={fieldId}
        className={small ? 'h-9 px-3' : undefined}
        type="search"
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setLoading(isSearchableQuery(nextQuery));
          setDismissed(false);
        }}
        onFocus={() => setDismissed(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
        }}
        placeholder={fieldPlaceholder}
        aria-label={label ?? fieldPlaceholder}
        maxLength={MAX_QUERY_LENGTH}
      />

      {showPanel && (
        <div
          className={
            panel === 'overlay'
              ? // max-h-72: on limite l'affichage vertical et met un slider
                'panel absolute left-0 top-full z-20 mt-2 flex max-h-72 w-full flex-col gap-1 overflow-y-auto p-1'
              : 'panel mt-2 flex flex-col gap-1 p-1'
          }
        >
          {panelState?.kind === 'too-short' && (
            <p className="px-3 py-2 text-sm text-text-muted">
              Type at least {MIN_QUERY_LENGTH} characters.
            </p>
          )}

          {panelState?.kind === 'searching' && (
            <p className="px-3 py-2 text-sm text-text-muted" aria-hidden="true">
              Searching…
            </p>
          )}

          {panelState?.kind === 'error' && (
            <p className="px-3 py-2 text-sm text-arena-red" role="alert">
              {panelState.message}
            </p>
          )}

          {panelState?.kind === 'empty' && (
            <p className="px-3 py-2 text-sm text-text-muted">No result found.</p>
          )}

          {panelState?.kind === 'results' && (
            // role="list" explicite : `list-style: none` (preflight Tailwind) fait perdre à
            // Safari la sémantique de liste dans l'arbre d'accessibilité.
            <ul role="list" className="flex flex-col gap-1">
              {panelState.results.map((result) => {
                const key = `${result.type}-${result.id}`;

                if (renderResult) {
                  return <Fragment key={key}>{renderResult(result)}</Fragment>;
                }

                return (
                  <DefaultRowRender
                    key={key}
                    result={result}
                    type={type}
                    small={small}
                    disabled={disabled}
                    gameByLadder={gameByLadder}
                    onSelect={handleSelect}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
