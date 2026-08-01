/**
 * Le titre de l'onglet, par route.
 *
 * 🚨 CE N'EST PAS DU CONFORT : WCAG **2.4.2 « Page Titled » est de niveau A**, le niveau le plus
 * bas de la norme — donc exigé avant même le AA que le module revendique. Les 13 routes rendaient
 * toutes le même « VS MODE » : dans une liste d'onglets, dans l'historique du navigateur et à
 * l'annonce d'un lecteur d'écran (qui lit le titre à chaque changement de page), rien ne
 * distinguait une page d'une autre.
 *
 * 🔑 POURQUOI UNE TABLE CENTRALE ET PAS UN `useEffect` PAR PAGE. Un titre posé par chaque page
 * n'est posé que si la page pense à le faire, et rien ne le rappelle : la 26ᵉ page l'oublie et
 * hérite en silence du titre de la précédente. Ici, une route absente de la table retombe sur le
 * titre nu — jamais sur celui de la page d'avant.
 *
 * ⚠️ Les routes à paramètre portent un titre GÉNÉRIQUE (« Team », pas le nom de l'équipe) : la
 * donnée n'est pas encore chargée au moment où la route change, et 2.4.2 demande un titre qui
 * décrit le SUJET ou le BUT de la page, pas l'identité de l'enregistrement affiché.
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
 * Routes à paramètre. ⚠️ Consultées APRÈS `STATIC_TITLES`, ce qui est ce qui empêche `/solo`
 * de tomber dans le motif de `/solo/$ladderId`.
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
