// this is how to render the default row from a search bar

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { GameByLadder } from '@/lib/games';
import type { SearchBarProps, SearchResult } from './SearchBar.tsx';

// `Pick` from typescript to build a type
//
// `onSelect` est REQUIS ici
type DefaultRowRenderProps = Pick<SearchBarProps, 'type' | 'small' | 'disabled'> & {
  result: SearchResult;
  onSelect: (result: SearchResult) => void;
  // 🚨 REÇUE EN PROP, JAMAIS RÉCUPÉRÉE ICI. Voir `useGameByLadder` : ce composant se rend
  // une fois par ligne, il n'est pas le bon endroit pour décider si `GET /ladders` part.
  // Une Map vide est un état normal (recherche joueurs-only) : le sous-titre reste vide.
  gameByLadder: GameByLadder;
};

export function DefaultRowRender({
  result,
  disabled,
  gameByLadder,
  onSelect,
  small,
  type,
}: DefaultRowRenderProps) {
  return (
    <li>
      <Button
        variant="secondary"
        type="button"
        disabled={disabled}
        onClick={() => onSelect(result)}
        className={small ? 'w-full justify-start gap-3 px-2' : 'w-full justify-start gap-3 px-3'}
      >
        {!small && (
          <Avatar
            src={(result.type === 'user' ? result.avatarUrl : result.logoUrl) ?? undefined}
            fallback={(result.type === 'user' ? result.pseudo : result.name)
              .slice(0, 2)
              .toUpperCase()}
            className="size-8"
          />
        )}
        <span className="min-w-0 normal-case">
          <span className="block truncate text-sm">
            {result.type === 'user' ? (result.displayName ?? result.pseudo) : result.name}
          </span>
          <span className="block truncate text-xs text-text-muted">
            {result.type === 'user'
              ? `@${result.pseudo}`
              : (() => {
                  const info = gameByLadder.get(result.ladderId);
                  return info ? `${info.game.toUpperCase()} · ${info.format}` : '';
                })()}
          </span>
        </span>
        {!type && (
          <span className="ml-auto label-caps text-xs text-action-primary-card-foreground">
            {result.type === 'user' ? 'PLAYER' : 'TEAM'}
          </span>
        )}
      </Button>
    </li>
  );
}
