#!/usr/bin/env node
/**
 * Lanceur : `node run.mjs [nom-du-scénario …]`
 * Sans argument, déroule tous les scénarios de `scenarios/`.
 *
 * Code de sortie : 0 = console propre ET tous les checks verts. 1 = au moins un
 * problème imputable au périmètre audité. 2 = le harnais lui-même a échoué (stack
 * éteinte, sélecteur obsolète) — à ne JAMAIS lire comme « console propre ».
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { awaitGlobalQuota, runScenario, report, ORIGIN } from './runner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);

const files = readdirSync(join(here, 'scenarios'))
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => wanted.length === 0 || wanted.some((w) => f.includes(w)));

if (files.length === 0) {
  console.error(`Aucun scénario ne correspond à : ${wanted.join(', ')}`);
  process.exit(2);
}

// La stack doit tourner : sans ça l'audit échouerait avec un message obscur. On tape
// /api/ping, donc à travers le proxy Vite — ça valide d'un coup le front ET le back.
try {
  const res = await fetch(`${ORIGIN}/api/ping`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`ping -> ${res.status}`);
} catch (err) {
  console.error(
    `\n❌ ${ORIGIN} ne répond pas (${err.message}).\n` +
      '   Lance la stack : docker compose up -d\n',
  );
  process.exit(2);
}

let worst = 0;
for (const file of files) {
  const scenario = await import(join(here, 'scenarios', file));
  // Le quota global (100/min PAR IP) est partagé par toute la campagne : sans cette attente,
  // les scénarios de fin de liste héritent du 429 provoqué par ceux du début. Ne coûte rien
  // quand il reste du quota (un GET /api/ping).
  await awaitGlobalQuota();
  console.log(`\n${'━'.repeat(78)}\n▶ ${scenario.name} — ${scenario.surface}\n${'━'.repeat(78)}`);
  const result = await runScenario(scenario);
  worst = Math.max(worst, report(scenario, result));
}

process.exit(worst);
