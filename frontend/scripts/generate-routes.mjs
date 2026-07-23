// Génère `src/routeTree.gen.ts` AVANT `tsc -b` dans le build (hook npm `prebuild`).
//
// Pourquoi : `routeTree.gen.ts` est GITIGNORÉ (généré à la volée par le plugin TanStack Router
// pendant `vite serve`/`vite build`). Mais `npm run build` = `tsc -b && vite build` : le
// type-check tourne AVANT que Vite ne génère le fichier → depuis un clone neuf, `tsc` échouait
// en TS2307 (module introuvable). On génère donc le route tree ici, en amont, sans versionner
// le fichier (la convention front reste inchangée).
//
// On utilise `@tanstack/router-generator` — la brique interne du plugin déjà présente dans les
// deps (transitive de `@tanstack/router-plugin`). Aucune dépendance ajoutée.
import { Generator, getConfig } from '@tanstack/router-generator';

const root = process.cwd();
// Mêmes options que le plugin dans vite.config.ts. getConfig applique les défauts (routesDirectory
// = src/routes, generatedRouteTree = src/routeTree.gen.ts), qui correspondent au projet.
const config = getConfig({ target: 'react', autoCodeSplitting: true }, root);

const generator = new Generator({ config, root });
await generator.run();

console.log('routeTree.gen.ts generated');
