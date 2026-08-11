/**
 * Tab title, per route. WCAG 2.4.2 is level A, so this is required, not polish.
 *
 * one central table instead of a useEffect per page: a page that forgets to set its title
 * silently inherits the previous one. a route missing from the table falls back to the bare
 * title, never to the page before it.
 * routes with a param get a generic title ("Team", not the team name) — the data isn't loaded
 * yet when the route changes.
 */

const SUFFIX = 'VS MODE';

/** Routes fixes — la clé est le pathname complet, la recherche est exacte. */
const STATIC_TITLES: Record<string, string> = {
  '/': SUFFIX,
  '/login': `Log in — ${SUFFIX}`,
  '/register': `Sign up — ${SUFFIX}`,
  '/privacy': `Privacy Policy — ${SUFFIX}`,
  '/terms': `Terms of Service — ${SUFFIX}`,
  '/home': `Home — ${SUFFIX}`,
  '/teams': `My teams — ${SUFFIX}`,
  '/solo': `Solo — ${SUFFIX}`,
  '/games': `Games — ${SUFFIX}`,
  '/matchmaking': `Open slots — ${SUFFIX}`,
  '/history': `My matches — ${SUFFIX}`,
  '/profile': `Profile — ${SUFFIX}`,
  '/admin/disputes': `Arbitration — ${SUFFIX}`,
};

/**
 * Routes à paramètre. Consultées APRÈS `STATIC_TITLES`, ce qui est ce qui empêche `/solo` de
 * tomber dans le motif de `/solo/$ladderId`.
 */
const DYNAMIC_TITLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/teams\/[^/]+\/?$/, `Team — ${SUFFIX}`],
  [/^\/players\/[^/]+\/?$/, `Player — ${SUFFIX}`],
  [/^\/games\/[^/]+\/?$/, `Game — ${SUFFIX}`],
  [/^\/ladders\/[^/]+\/?$/, `Ladder — ${SUFFIX}`],
  [/^\/solo\/[^/]+\/?$/, `Solo ladder — ${SUFFIX}`],
  [/^\/matches\/[^/]+\/?$/, `Match — ${SUFFIX}`],
  [/^\/disputes\/[^/]+\/?$/, `Dispute — ${SUFFIX}`],
];

export function titleForPath(pathname: string): string {
  const exact = STATIC_TITLES[pathname];
  if (exact) return exact;

  for (const [pattern, title] of DYNAMIC_TITLES) {
    if (pattern.test(pathname)) return title;
  }

  return SUFFIX;
}
