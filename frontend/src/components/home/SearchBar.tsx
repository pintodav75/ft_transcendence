// todo: make it a template that takes either a user or a team?
// this is an EXACT search bar for an exact username

import { useState, useEffect, useRef } from 'react';

import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { apiFetch, ApiError } from '@/lib/api';
import { Button } from '../ui/button';

import type { components } from '@/lib/api-types.gen';

// The exact-match route (GET /users/:pseudo) returns a PublicUser; we only read
// id/pseudo/displayName/avatarUrl from it for the result row.
type UserSearchResult = components['schemas']['PublicUser'];

type SearchBarProp = {
  onSelect?: (res: UserSearchResult) => void; // function to trigger when clicking on a user
  placeholder?: string; // txt to display in the search bar
  excludeIds?: string[]; // ids to exclude, eg bloqued users or people already in the team
};

const KEYWAIT_TIMEOUT_MS = 300; // also called DEBOUNCE_MS

export function SearchBar({
  onSelect = () => {},
  placeholder = 'Search a user by pseudo...',
  excludeIds,
}: SearchBarProp) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const trimmed = query.trim();
      if (!trimmed) {
        // if it's empty, dont query
        setResults([]);
        setError(undefined);
        setLoading(false);
        return;
      }
      setLoading(true);
      // Exact match: hit the public profile route. 200 => that exact pseudo
      // exists, 404 => no user carries it (a legitimate empty result, not an error).
      const url = `/users/${encodeURIComponent(trimmed)}`;
      apiFetch<{ user: UserSearchResult }>(url, { signal: controller.signal })
        .then(
          // success — exactly one match
          ({ user }) => {
            if (requestId !== latestRequest.current) return;
            setResults([user]);
            setError(undefined);
          },
        )
        .catch((err) => {
          if (controller.signal.aborted || requestId !== latestRequest.current) return;
          // 404 means "no user with that exact pseudo" — show the empty panel, not an error.
          if (err instanceof ApiError && err.status === 404) {
            setResults([]);
            setError(undefined);
            return;
          }
          setError(err instanceof ApiError ? err.message : 'Search failed.');
          setResults([]);
        })
        .finally(() => {
          if (requestId === latestRequest.current) setLoading(false);
        });
    }, KEYWAIT_TIMEOUT_MS);

    // Runs on the next keystroke (or unmount): cancel the pending call.
    // return cleanup function
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const visible = excludeIds ? results.filter((user) => !excludeIds.includes(user.id)) : results;

  const showPanel = query.trim().length > 0;
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
          {loading && <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>}

          {!loading && error && (
            <p className="px-3 py-2 text-sm text-arena-red" role="alert">
              {error}
            </p>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-muted">No result found.</p>
          )}

          {!loading &&
            !error &&
            visible.map((user) => (
              <Button
                variant="secondary"
                key={user.id}
                type="button"
                onClick={() => onSelect(user)}
                className="gap-3 "
              >
                <Avatar
                  src={user.avatarUrl ?? undefined}
                  fallback={user.pseudo.slice(0, 2).toUpperCase()}
                  className="size-8"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{user.displayName ?? user.pseudo}</span>
                  <span className="block truncate text-xs text-text-muted">@{user.pseudo}</span>
                </span>
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
