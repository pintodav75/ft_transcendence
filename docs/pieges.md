# Pièges déjà rencontrés (détaillé)

> Extrait de CLAUDE.md (refacto 25/07). Version longue des 20 pièges ; CLAUDE.md n'en garde que les titres.

## 🚨 Pièges déjà rencontrés

1. **Espaces dans `.env`** : `VAR=valeur` sans espaces
2. **Données PostgreSQL en bind mount** : changer `POSTGRES_USER/PASSWORD` après initialisation ne reconfigure pas la base existante. `docker compose down -v` ne supprime pas `./data/postgres` ; une réinitialisation exige de supprimer explicitement ce dossier après sauvegarde (opération destructive)
3. **Hot reload WSL2 + Docker** : polling obligatoire (`CHOKIDAR_USEPOLLING=true` ; `server.watch.usePolling` Vite)
4. **Fastify host** : toujours `host: '0.0.0.0'`
5. **Nom de service ≠ localhost** dans le réseau Docker (`postgres:5432`)
6. **Fastify affiche `127.0.0.1`** même en écoute `0.0.0.0` (cosmétique)
7. **`node_modules` dans bind mount** : volume anonyme `/app/node_modules`. Il ne se met pas à jour seul lorsqu'une dépendance change. Les entrypoints I3 comparent désormais le hash de `package-lock.json` au marqueur du volume et lancent `npm ci` uniquement si nécessaire (I1 est ainsi conservé sans réinstallation systématique)
8. **Enum Drizzle sans `export`** non détecté par drizzle-kit → migration cassée. Toujours `export const xxxEnum = pgEnum(...)`
9. **Interop CJS `@fastify/oauth2`** + `verbatimModuleSyntax` : workaround `(oauth2 as any).GOOGLE_CONFIGURATION`
10. **F0 front = fondation visuelle uniquement** : ne pas traiter `App.tsx` comme une vraie page login ; elle sert seulement de référence DA temporaire
11. **Certificat HTTPS dev** : l'entrypoint backend le génère automatiquement dans le volume `backend_certs` (partagé au frontend en lecture seule) avec `subjectAltName=DNS:localhost,IP:127.0.0.1`. Il faut accepter **une seule** empreinte, sur **`https://localhost:5173`** (l'origine applicative). Si le cert est régénéré : redémarrer le frontend et ré-accepter l'empreinte.
12. **Migrations au démarrage** : l'entrypoint backend lance `drizzle-kit migrate` avant Fastify. La commande manuelle ne sert plus qu'au diagnostic
13. **Redis officiel** : la variable `REDIS_PASSWORD` seule n'active rien. Le Compose lance explicitement `redis-server --requirepass` et le backend fournit ce mot de passe au client
14. **Un check en code n'est JAMAIS atomique** (leçon de la review de B5c). Entre le moment où tu lis (« ce joueur est-il libre ? ») et celui où tu écris, une autre requête a pu changer le monde — c'est le TOCTOU. Un `UPDATE ... WHERE status='pending'` ne sérialise que les acteurs qui visent **la même ligne** ; deux requêtes sur des **lignes différentes** passent toutes les deux. Pour un invariant qui porte sur un **acteur** (« un seul match actif par équipe »), il faut un **verrou** (`pg_advisory_xact_lock`) **et** re-jouer la vérification **dans** la transaction, sous ce verrou. Cf. `isLockedOut` / `hasOpenSlot` / `lockCompetitors` dans `routes/matches.ts`.
15. **Verrous multiples → les prendre dans un ORDRE DÉTERMINISTE** (trier les clés). Sinon : A verrouille x puis attend y pendant que B verrouille y puis attend x → **interblocage**. Postgres le détecte et tue une transaction → **500 sur un conflit métier normal**. C'est arrivé sur l'acceptation croisée (alice prend le slot de bob pendant que bob prend celui d'alice). L'acquisition ordonnée est le remède canonique.
16. **Les fenêtres de temps se comparent avec des inégalités STRICTES** (`<`, jamais `<=`) — cf. `hasConflictingMatch()`. Deux matchs qui se **touchent** (21h–22h puis 22h–23h) ne se chevauchent **pas** : c'est ce qui autorise l'enchaînement dos à dos, le cas d'usage central de B5d. Écrire `<=` par réflexe casse la feature sans rien faire échouer d'évident.
17. **Un slot périmé ne doit bloquer personne.** Le job d'expiration tourne à la minute : il existe donc toujours une fenêtre où un slot est **mort mais encore `pending`** en base. Tout ce qui compte les slots (check de conflit, plafond, liste publique) doit **les ignorer** — sinon un slot mort empêche son propre créateur d'en rouvrir un. Ne jamais se reposer sur le seul statut en base.
18. **Tester une course sans barrière ne prouve RIEN.** Deux threads lancés à la suite démarrent en décalé et ne se croisent jamais : le test **passe** alors que le bug est bien là. Faux négatif — pire qu'aucun test. Utiliser `threading.Barrier` et **répéter** (une course ne se déclenche pas à tous les coups). L'interblocage ci-dessus a été masqué comme ça au premier essai.
19. **Un typage `server.get<{ Params: { id: string } }>` ne valide RIEN à l'exécution.** Le générique TypeScript ne fait que *décrire* la forme attendue : à l'exécution, `request.params.id` contient ce que l'URL a envoyé. Passer cette chaîne à une requête Drizzle sur une colonne `uuid` fait échouer Postgres (`22P02 invalid input syntax for type uuid`) → le catch générique rend **500 alors que la bonne réponse est 400**. Seul un `.parse()` Zod valide réellement (**T4**, 24/07 : 9 points d'appel corrigés). Corollaire : ne jamais se sentir rassuré par un type sur une entrée qui vient du réseau.
20. **`npx tsc --noEmit` dans `frontend/` ne vérifie RIEN — faux vert.** `frontend/tsconfig.json` est un fichier *solution* (`"files": []` + `references` vers `tsconfig.app.json`/`tsconfig.node.json`), et **en mode non-build `tsc` ne suit pas les `references`** : il type 0 fichier et sort 0. Mesuré (review T3, 24/07). ✅ `npm run build` (= `tsc -b && vite build`) type-check **réellement**, donc toutes les recettes de l'équipe qui disent « build ✓ » restent valides. **Commande correcte pour un type-check seul : `npx tsc -b --noEmit`** (ou `npx tsc -p tsconfig.app.json --noEmit`).

---

