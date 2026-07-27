import { useEffect, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';

import type { paths } from '@/lib/api-types.gen';

// PREFIX search over players, backed by GET /search?q=&type=user.
//
// It used to hit GET /users/{pseudo}, an EXACT-match route, and read its 404 as "no
// result". That made every keystroke without a perfect match print a red "Failed to load
// resource" in Chrome — a console-audit failure, i.e. a project-rejection criterion.
// /search answers 200 with an empty list instead, which is what an empty result IS.

type SearchResponse = paths['/search']['get']['responses'][200]['content']['application/json'];
type SearchResult = SearchResponse['results'][number];
// Results are a tagged union (user | team): narrow on `type` before reading pseudo.
export type UserSearchResult = Extract<SearchResult, { type: 'user' }>;

type UserSearchProps = {
  /** Called when a result row is clicked. */
  onSelect?: (user: UserSearchResult) => void;
  placeholder?: string;
  /**
   * Ids to hide from the results — /search filters neither the current roster nor the
   * players already committed to a team on this ladder, so the caller has to.
   */
  excludeIds?: string[];
  /**
   * Blocks every result row while the caller's own mutation is in flight. Without it a
   * second click fires a duplicate request before `excludeIds` has had time to refresh.
   */
  disabled?: boolean;
};

const DEBOUNCE_MS = 300;
// Mirrors the backend's own bounds (`q` trimmed, 2 to 50). Out of range is a 400, and a
// 400 is a red line in the console, so the request is simply not sent.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 50;
const RESULT_LIMIT = 10;

export function UserSearch({
  onSelect = () => {},
  placeholder = 'Search a player by pseudo…',
  excludeIds,
  disabled = false,
}: UserSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Guards against out-of-order responses: a slow request answering after a newer one
  // would otherwise overwrite fresher results.
  const latestRequest = useRef(0);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const tooLong = trimmed.length > MAX_QUERY_LENGTH;

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const term = query.trim();

      if (term.length < MIN_QUERY_LENGTH || term.length > MAX_QUERY_LENGTH) {
        setResults([]);
        setError(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      const params = new URLSearchParams({
        q: term,
        type: 'user',
        limit: String(RESULT_LIMIT),
      });

      apiFetch<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal })
        .then(({ results: found }) => {
          if (requestId !== latestRequest.current) return;
          setResults(found.filter((item) => item.type === 'user'));
          setError(undefined);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted || requestId !== latestRequest.current) return;
          setError(searchError instanceof ApiError ? searchError.message : 'Search failed.');
          setResults([]);
        })
        .finally(() => {
          if (requestId === latestRequest.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    // Runs on the next keystroke (or on unmount): drop the pending timer and abort a
    // request already on the wire.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const visible = excludeIds ? results.filter((user) => !excludeIds.includes(user.id)) : results;
  const showPanel = trimmed.length > 0;
  const ready = !tooShort && !tooLong;

  return (
    <div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label="Search players"
      />

      {showPanel && (
        <div className="panel mt-2 flex flex-col gap-1 p-1">
          {tooShort && (
            <p className="px-3 py-2 text-sm text-text-muted">
              Type at least {MIN_QUERY_LENGTH} characters.
            </p>
          )}

          {tooLong && (
            <p className="px-3 py-2 text-sm text-text-muted">
              Use {MAX_QUERY_LENGTH} characters or fewer.
            </p>
          )}

          {ready && loading && <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>}

          {ready && !loading && error && (
            <p className="px-3 py-2 text-sm text-arena-red" role="alert">
              {error}
            </p>
          )}

          {ready && !loading && !error && visible.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-muted">No result found.</p>
          )}

          {ready && !loading && !error && visible.length > 0 && (
            // role="list" is explicit because `list-style: none` (Tailwind preflight)
            // makes Safari drop list semantics from the accessibility tree.
            <ul role="list" className="flex flex-col gap-1">
              {visible.map((user) => (
                <li key={user.id}>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => onSelect(user)}
                    className="w-full justify-start gap-3"
                  >
                    <Avatar
                      src={user.avatarUrl ?? undefined}
                      fallback={user.pseudo.slice(0, 2).toUpperCase()}
                      className="size-8"
                    />
                    {/* `normal-case` annule le `uppercase` de `buttonClasses` : un pseudo est
                        un identifiant sensible à la casse, et afficher « @AUDIT185031 » pour
                        `audit185031` induit en erreur au moment précis où le capitaine doit
                        reconnaître le bon joueur. */}
                    <span className="min-w-0 normal-case">
                      <span className="block truncate text-sm">
                        {user.displayName ?? user.pseudo}
                      </span>
                      <span className="block truncate text-xs text-text-muted">@{user.pseudo}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
