import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import { useLadders } from '@/lib/games';

import type { paths } from '@/lib/api-types.gen';

// PREFIX search over players and teams, backed by GET /search.

type SearchResponse = paths['/search']['get']['responses'][200]['content']['application/json'];
// Les résultats sont une union discriminée (user | team) : narrow sur `type` avant de lire
// `pseudo` ou `name`.
export type SearchResult = SearchResponse['results'][number];

type SearchBarProps = {
  /** Restreint la recherche à un seul type. Absent = joueurs ET équipes. */
  type?: 'user' | 'team';
  limit?: number;
  /** Masque les avatars : le LeftRail ne fait que 240 px de contenu. */
  small?: boolean;
  /** Appelé au clic sur une ligne. Par défaut : navigation vers la fiche. */
  onSelect?: (result: SearchResult) => void;
  placeholder?: string;
  /** `aria-label` du champ. Par défaut le placeholder. */
  label?: string;
  /**
   * Ids à masquer — `/search` ne connaît ni le roster courant ni les joueurs déjà engagés
   * sur le ladder, c'est donc à l'appelant de filtrer.
   */
  excludeIds?: string[];
  /**
   * Bloque toutes les lignes pendant la mutation de l'appelant. Sans ça un second clic part
   * avant que `excludeIds` ait eu le temps de se rafraîchir.
   */
  disabled?: boolean;
  /**
   * `overlay` fait flotter le panneau au-dessus de la page (LeftRail : la nav en dessous ne
   * doit pas sauter) ; `inline` le pousse dans le flux (onglet Manage : il vit dans un
   * formulaire, recouvrir le roster masquerait justement ce qu'on vérifie).
   */
  panel?: 'overlay' | 'inline';
};

const DEBOUNCE_MS = 300;
// Reprend les bornes du back (`q` trimmé, 2 à 50 — routes/search.ts). Hors bornes = 400, et
// un 400 est une ligne rouge dans la console, donc la requête ne part simplement pas.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 50;
const RESULT_LIMIT = 10;

function defaultPlaceholder(type: SearchBarProps['type']): string {
  if (type === 'user') return 'Search a player by pseudo…';
  if (type === 'team') return 'Search a team by name…';
  return 'Search a player or team…';
}

export function SearchBar({
  type,
  limit = RESULT_LIMIT,
  small = false,
  onSelect,
  placeholder,
  label,
  excludeIds,
  disabled = false,
  panel = 'overlay',
}: SearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Fermeture EXPLICITE du panneau. Elle ne peut pas se déduire du seul texte saisi : sinon
  // rien ne le referme jamais, ni un clic ailleurs ni Escape, et il reste posé sur la nav.
  const [dismissed, setDismissed] = useState(false);
  // Vrai dès que le champ a reçu le focus une première fois — voir `useLadders` juste en bas.
  const [searchTouched, setSearchTouched] = useState(false);
  // Délimite « l'intérieur » de la barre pour la fermeture au clic extérieur.
  const containerRef = useRef<HTMLDivElement>(null);
  // Garde contre les réponses hors ordre : une requête lente répondant après une plus récente
  // écraserait sinon des résultats plus frais.
  const latestRequest = useRef(0);

  const fieldPlaceholder = placeholder ?? defaultPlaceholder(type);

  // Une recherche restreinte aux joueurs ne rendra jamais d'équipe : pas de `GET /ladders`.
  //
  // La table ne sert qu'au sous-titre d'un résultat d'ÉQUIPE. On l'attend donc du premier
  // focus plutôt que du premier résultat : elle arrive en cache pendant que l'utilisateur
  // tape (300 ms de débounce + un aller-retour), donc sans sous-titre vide qui se remplit
  // après coup, et elle ne coûte RIEN sur les pages où personne ne cherche.
  const { data: laddersData } = useLadders({ enabled: type !== 'user' && searchTouched });
  // `/search` ne rend qu'un `ladderId` sur une équipe, jamais son jeu : on reconstruit la
  // correspondance côté client.
  const gameByLadder = useMemo(() => {
    const map = new Map<string, { game: string; format: string }>();
    for (const ladder of laddersData?.ladders ?? []) {
      map.set(ladder.id, { game: ladder.gameId, format: ladder.format });
    }
    return map;
  }, [laddersData]);

  function defaultSelect(result: SearchResult) {
    if (result.type === 'team') {
      navigate({ to: '/teams/$teamId', params: { teamId: result.id } });
    } else {
      navigate({ to: '/players/$pseudo', params: { pseudo: result.pseudo } });
    }
    setQuery('');
  }
  const handleSelect = onSelect ?? defaultSelect;

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const trimmed = query.trim();

      if (trimmed.length < MIN_QUERY_LENGTH || trimmed.length > MAX_QUERY_LENGTH) {
        setResults([]);
        setError(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
      if (type) params.set('type', type);

      apiFetch<SearchResponse>(`/search?${params.toString()}`, { signal: controller.signal })
        .then(({ results: found }) => {
          if (requestId !== latestRequest.current) return;
          setResults(found);
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

    // Au prochain caractère (ou au démontage) : on jette le timer en attente et on avorte une
    // requête déjà sur le fil.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, type, limit]);

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const visible = excludeIds
    ? results.filter((result) => !excludeIds.includes(result.id))
    : results;
  const showPanel = trimmed.length > 0 && !dismissed;

  // Fermeture au clic extérieur.
  //
  // `pointerdown` et non `click` : le panneau doit céder la place dès l'appui, pas une fois le
  // clic résolu. ⚠️ Les lignes de résultat vivent DANS `containerRef`, donc cliquer une ligne
  // ne ferme pas — sinon le bouton se démonterait avant que son `onClick` ne parte et la
  // sélection ne marcherait plus du tout.
  useEffect(() => {
    if (!showPanel) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setDismissed(true);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showPanel]);

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        // Dans le rail, le champ générique (`h-12`, 48 px) était PLUS HAUT que les items de
        // nav (~42 px) : il écrasait visuellement la navigation qu'il surplombe. La maquette
        // le dessine à `padding: 9px 12px`, soit 36 px — d'où `h-9 px-3`, qui rend le champ
        // plus fin et donc plus allongé. Hors du rail (onglet Manage), la taille standard du
        // design system est conservée : le champ y est seul dans son bloc, rien à équilibrer.
        className={small ? 'h-9 px-3' : undefined}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // On vient peut-être de fermer au clic extérieur : retaper doit rouvrir.
          setDismissed(false);
        }}
        // Déclenche le chargement des ladders (voir `useLadders` plus haut) et rouvre un
        // panneau fermé quand on revient dans un champ qui contient déjà du texte.
        onFocus={() => {
          setSearchTouched(true);
          setDismissed(false);
        }}
        // Escape vide le champ. `type="search"` le fait déjà nativement sur Chrome, mais PAS
        // sur Firefox — que le sujet impose de supporter. La fermeture au clavier ne doit pas
        // dépendre du navigateur, d'autant que l'audit ne pilote que Chrome et ne verrait
        // jamais le trou.
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
        }}
        placeholder={fieldPlaceholder}
        aria-label={label ?? fieldPlaceholder}
        // Le navigateur tronque aussi un COLLAGE à `maxLength` : `query` ne peut donc pas
        // sortir des bornes du back. La garde de l'effet couvre le reste (50 caractères dont
        // des espaces, qui repassent sous la borne une fois trimmés).
        maxLength={MAX_QUERY_LENGTH}
      />

      {showPanel && (
        <div
          className={
            panel === 'overlay'
              ? // BORNE DE HAUTEUR — `RESULT_LIMIT` vaut 10 et une ligne fait 48 px (h-12) :
                // sans plafond le panneau flottant mesure ~500 px et recouvre TOUTE la
                // navigation du rail, items du bas compris. 18rem laisse voir ~3,5 lignes,
                // donc assez pour comprendre qu'il faut défiler, et jamais plus de deux ou
                // trois items masqués. Le défilement est celui du panneau, pas de la page.
                'panel absolute left-0 top-full z-20 mt-2 flex max-h-72 w-full flex-col gap-1 overflow-y-auto p-1'
              : 'panel mt-2 flex flex-col gap-1 p-1'
          }
        >
          {tooShort && (
            <p className="px-3 py-2 text-sm text-text-muted">
              Type at least {MIN_QUERY_LENGTH} characters.
            </p>
          )}

          {!tooShort && loading && <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>}

          {!tooShort && !loading && error && (
            <p className="px-3 py-2 text-sm text-arena-red" role="alert">
              {error}
            </p>
          )}

          {!tooShort && !loading && !error && visible.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-muted">No result found.</p>
          )}

          {!tooShort && !loading && !error && visible.length > 0 && (
            // role="list" explicite : `list-style: none` (preflight Tailwind) fait perdre à
            // Safari la sémantique de liste dans l'arbre d'accessibilité.
            <ul role="list" className="flex flex-col gap-1">
              {visible.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelect(result)}
                    className={
                      small ? 'w-full justify-start gap-3 px-2' : 'w-full justify-start gap-3 px-3'
                    }
                  >
                    {!small && (
                      <Avatar
                        src={
                          (result.type === 'user' ? result.avatarUrl : result.logoUrl) ?? undefined
                        }
                        fallback={(result.type === 'user' ? result.pseudo : result.name)
                          .slice(0, 2)
                          .toUpperCase()}
                        className="size-8"
                      />
                    )}

                    {/* `normal-case` annule le `uppercase` de `buttonClasses` : un pseudo est
                        un identifiant sensible à la casse, et afficher « @AUDIT185031 » pour
                        `audit185031` induit en erreur au moment précis où l'utilisateur doit
                        reconnaître la bonne personne. */}
                    <span className="min-w-0 normal-case">
                      <span className="block truncate text-sm">
                        {result.type === 'user'
                          ? (result.displayName ?? result.pseudo)
                          : result.name}
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

                    {/* Sans `type`, les deux sortes de résultats se mélangent : la ligne doit
                        dire laquelle on s'apprête à ouvrir. */}
                    {!type && (
                      <span className="ml-auto label-caps text-xs text-action-primary-card-foreground">
                        {result.type === 'user' ? 'PLAYER' : 'TEAM'}
                      </span>
                    )}
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
