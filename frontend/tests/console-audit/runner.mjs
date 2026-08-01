/**
 * Moteur d'audit de la console Chrome.
 *
 * Le sujet fait de « zéro warning ET zéro erreur dans la console » un motif de REJET
 * du projet. Ce moteur transforme ce critère en commande : il pilote un vrai Chromium,
 * déroule un scénario par ticket, et échoue si la console dit quoi que ce soit.
 *
 * ⚠️ Le panneau Console de DevTools agrège TROIS flux distincts, et un audit qui n'en
 * écoute qu'un donne un faux vert :
 *   1. Runtime.consoleAPICalled  -> page.on('console')   : les console.* du JS
 *   2. Runtime.exceptionThrown   -> page.on('pageerror') : les exceptions non attrapées
 *   3. Log.entryAdded (CDP)      -> AUCUN équivalent Playwright : les messages émis par
 *      le NAVIGATEUR lui-même — « Failed to load resource: 404 », CORS, contenu mixte,
 *      dépréciations. C'est la source qu'on oublie, et c'est celle des lignes rouges
 *      de 404 d'images, donc exactement ce qu'un correcteur voit en premier.
 */
import { chromium } from 'playwright-core';
import { randomFillSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

import { sql } from './sql.mjs';

export const ORIGIN = process.env.AUDIT_ORIGIN ?? 'https://localhost:5173';

// Le certificat de dev est auto-signé (I2) : node comme le navigateur doivent l'accepter,
// exactement comme l'exception que tu poses à la main dans Chrome au premier chargement.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * Bruit que l'audit constate mais n'impute PAS au ticket en cours.
 *
 * ⚠️ Toute entrée ici est une DETTE ASSUMÉE, pas un pardon : elle est affichée dans le
 * rapport, avec sa raison et son ticket d'origine. Quand la dette est payée, on retire
 * la ligne — si elle ne sert plus à rien, le rapport le dira (« 0 fois »).
 *
 * `tooling: true` marque le bruit qui n'existe QUE en dev (serveur Vite, build de
 * développement de React) : lui seul survit au mode strict, parce qu'aucune décision
 * produit ne le concerne — il disparaît au build de prod.
 */
const OUT_OF_SCOPE = [
  {
    match: /\[vite\]|React DevTools/,
    reason: 'serveur de dev + build de développement de React — absent du build de prod',
    owner: 'aucun (outillage)',
    tooling: true,
  },
];

/**
 * `AUDIT_STRICT=1` : plus rien n'est excusé sauf le bruit d'outillage. C'est le mode des
 * AUDITS TRANSVERSES, où la dette héritée est justement ce qu'on cherche à chiffrer —
 * par opposition à la review d'un ticket, qui ne doit juger que son propre périmètre.
 */
const STRICT = process.env.AUDIT_STRICT === '1';

// ---------------------------------------------------------------- navigateur

/** Playwright-core ne télécharge aucun navigateur : on retrouve celui de la machine. */
function resolveChromium() {
  if (process.env.AUDIT_CHROMIUM) return process.env.AUDIT_CHROMIUM;

  const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
  if (existsSync(cache)) {
    // chromium-<build>/chrome-linux64/chrome — le numéro de build bouge, on le cherche.
    const dir = readdirSync(cache)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .pop();
    if (dir) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const bin = join(cache, dir, rel);
        if (existsSync(bin)) return bin;
      }
    }
  }

  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(bin)) return bin;
  }

  throw new Error(
    'Aucun Chromium trouvé.\n' +
      '  -> npx playwright install chromium   (télécharge dans ~/.cache/ms-playwright)\n' +
      '  -> ou AUDIT_CHROMIUM=/chemin/vers/chrome node run.mjs',
  );
}

// ---------------------------------------------------------------- fixtures

/** Encodeur PNG minimal : évite de versionner un binaire de 5,6 Mo pour le test de taille. */
function png(path, w, h, pixels) {
  const raw = Buffer.concat(
    Array.from({ length: h }, (_, y) =>
      Buffer.concat([Buffer.from([0]), pixels.subarray(y * w * 3, (y + 1) * w * 3)]),
    ),
  );
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, truecolor RGB
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return path;
}

function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'console-audit-'));

  const small = Buffer.alloc(400 * 400 * 3);
  for (let i = 0; i < small.length; i += 3) small.set([20, 30, 90], i);

  // Bruit ALÉATOIRE, donc incompressible : le fichier pèse réellement > 2 Mo. Une image
  // unie de 4000×4000 se compresserait à quelques Ko et ne testerait rien.
  const w = 1400;
  const noise = Buffer.alloc(w * w * 3);
  randomFillSync(noise);

  return {
    dir,
    ok: png(join(dir, 'ok.png'), 400, 400, small),
    big: png(join(dir, 'big.png'), w, w, noise),
    // GIF 1×1 valide : type non autorisé par ACCEPTED_MIME_TYPES.
    bad: (() => {
      const p = join(dir, 'bad.gif');
      writeFileSync(
        p,
        Buffer.from(
          '47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b',
          'hex',
        ),
      );
      return p;
    })(),
  };
}

// ---------------------------------------------------------------- compte de test

/**
 * Un compte NEUF par run, créé par l'API : passer par la page d'inscription ferait
 * traverser du code hors périmètre et se heurterait à son rate limit (3/min).
 *
 * ⚠️ `suffix` distingue les comptes d'un même run (le stamp est une milliseconde, deux
 * appels rapprochés se marcheraient dessus et le second sortirait en 409).
 */
/**
 * `POST /auth/register` est plafonné à 3/min PAR IP. Une campagne complète en consomme
 * bien plus (un compte par scénario, plus ceux créés à la demande, plus la soumission
 * volontaire de `auth-register`).
 *
 * ⚠️ On ATTEND le créneau au lieu d'encaisser le 429 : un 429 provoqué par l'audit
 * lui-même apparaîtrait dans le rapport comme une erreur de l'application. Le harnais ne
 * doit jamais fabriquer le rouge qu'il prétend mesurer.
 */
const registerHits = [];

/**
 * ⚠️ 75 s, pas 61 : notre modèle est une fenêtre GLISSANTE, celle du serveur est FIXE (elle
 * démarre à la première requête de la clé et se réinitialise d'un bloc). Les deux se
 * décalent, et un décalage de quelques secondes suffit à faire partir une inscription qui,
 * côté serveur, est la 4ᵉ de sa fenêtre — le 429 tombe alors sur le formulaire d'un
 * scénario, où il se lit comme un défaut de l'application. La marge coûte une attente de
 * plus par campagne et supprime la classe de faux rouge.
 */
const REGISTER_WINDOW_MS = 75_000;

/**
 * Plafond de `/auth/register` tel que le SERVEUR l'applique. 3 par défaut, mais le backend
 * multiplie tous ses quotas par `RATE_LIMIT_FACTOR` (voir `backend/src/utils/rate-limit.ts`) :
 * à 1000, ces attentes disparaissent et une campagne cesse d'être dominée par du sommeil.
 *
 * ⚠️ On le LIT sur l'en-tête `x-ratelimit-limit` de la réponse plutôt que de configurer le
 * harnais en parallèle du backend : deux réglages à tenir synchronisés divergent, et la panne
 * est silencieuse (soit on attend pour rien, soit on prend un vrai 429 dans le rapport).
 * Ici, le serveur est la seule source de vérité et le harnais s'aligne tout seul.
 */
let registerMax = 3;

export async function awaitRegisterSlot() {
  for (;;) {
    const now = Date.now();
    while (registerHits.length > 0 && now - registerHits[0] > REGISTER_WINDOW_MS)
      registerHits.shift();
    if (registerHits.length < registerMax) {
      registerHits.push(now);
      return;
    }
    const wait = REGISTER_WINDOW_MS - (now - registerHits[0]);
    console.log(
      `   ⏳ quota register (${registerMax}/min) atteint — attente de ${Math.ceil(wait / 1000)} s`,
    );
    await new Promise((r) => setTimeout(r, wait + 250));
  }
}

/**
 * Attend que le quota GLOBAL (100/min) soit reconstitué avant de lancer un scénario.
 *
 * ⚠️ Ce quota est compté PAR IP pour tout ce qui n'authentifie pas la requête, et les routes
 * de référence (`/games`, `/ladders`, `/ladders/{id}`, `/ladders/{id}/rankings`,
 * `/auth/refresh`) sont PUBLIQUES : `request.user` y est vide, donc `rateLimitKey` retombe
 * sur l'IP **même quand un Bearer est envoyé**. Toute la campagne — chaque scénario, chaque
 * `page.goto` qui rejoue `restoreSession()` — partage donc UN SEUL compteur.
 *
 * Mesuré : à partir du 4ᵉ scénario, la campagne dépassait les 100 req/min et le 429 qui suit
 * est INDISCERNABLE d'un vrai défaut dans le rapport (session non restaurée -> redirection
 * vers la landing -> `/games` 429 -> 3 réessais de TanStack Query). Le harnais fabriquait le
 * rouge qu'il prétend mesurer, et l'ordre alphabétique des fichiers décidait qui le prenait.
 *
 * Même philosophie qu'`awaitRegisterSlot` : on attend le créneau, on ne l'encaisse pas.
 * `/api/ping` porte les en-têtes `x-ratelimit-*` du même compteur (vérifié : 99 puis 98).
 */
export async function awaitGlobalQuota(minRemaining = 60) {
  for (;;) {
    let res;
    try {
      res = await fetch(`${ORIGIN}/api/ping`, { signal: AbortSignal.timeout(5000) });
    } catch {
      return; // stack injoignable : run.mjs le dira mieux que nous
    }

    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '0');
    if (res.ok && remaining >= minRemaining) return;

    const reset = Number(res.headers.get('x-ratelimit-reset') ?? '60');
    const limit = res.headers.get('x-ratelimit-limit') ?? '100';
    console.log(
      `   ⏳ quota global (${limit}/min par IP) : ${remaining} restante(s) — attente de ${reset + 1} s`,
    );
    await new Promise((r) => setTimeout(r, (reset + 1) * 1000));
  }
}

async function createAuditUser(suffix = '') {
  await awaitRegisterSlot();
  const stamp = `${Date.now().toString().slice(-9)}${suffix}`;
  const user = {
    pseudo: `audit${stamp}`.slice(0, 30),
    email: `audit${stamp}@example.com`,
    password: 'Audit-Console-2026!',
  };

  let res;
  // `register` est à 3/min PAR IP. Une campagne complète crée un compte par scénario et
  // dépasse ce quota en rafale : on attend la fenêtre plutôt que de faire échouer l'audit
  // sur une limite qui n'a rien à voir avec ce qu'on mesure.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${ORIGIN}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(user),
    });
    // Le serveur annonce son propre plafond : on s'y aligne pour les créneaux suivants.
    const announced = Number(res.headers.get('x-ratelimit-limit'));
    if (Number.isInteger(announced) && announced >= 1) registerMax = announced;
    if (res.status !== 429 || attempt >= 3) break;
    console.log('   ⏳ register rate-limité, attente de la fenêtre (21 s)…');
    await new Promise((r) => setTimeout(r, 21_000));
  }
  if (res.status !== 201) {
    throw new Error(`register a répondu ${res.status} : ${await res.text()}`);
  }

  const { accessToken } = await res.json();
  // Le cookie de refresh renvoyé ici est INJECTÉ dans le navigateur (voir runScenario) :
  // ça ouvre la session sans passer par le formulaire, donc sans consommer le quota de
  // `login` (5/min), tout en empruntant le vrai chemin restoreSession() de l'app.
  const cookies = (res.headers.getSetCookie?.() ?? []).map((raw) => {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair.indexOf('=');
    const path = attrs.find((a) => a.trim().toLowerCase().startsWith('path='));
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: new URL(ORIGIN).hostname,
      path: path ? path.split('=')[1].trim() : '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    };
  });

  return { ...user, accessToken, stamp, cookies };
}

/**
 * Dissout les équipes du compte AVANT de le supprimer.
 *
 * ⚠️ Indispensable : supprimer l'utilisateur efface ses équipes en CASCADE côté SQL, ce
 * qui court-circuite `removeHostedObject()` — le logo uploadé resterait pour toujours
 * dans le bucket MinIO. Passer par `DELETE /teams/:id` emprunte le chemin applicatif,
 * qui nettoie l'objet. Constaté : 4 fichiers orphelins après quelques campagnes.
 */
async function purgeUserTeams(user) {
  const auth = { authorization: `Bearer ${user.accessToken}` };
  try {
    const res = await fetch(`${ORIGIN}/api/teams`, { headers: auth });
    if (!res.ok) return;
    const { teams = [] } = await res.json();
    for (const team of teams) {
      await fetch(`${ORIGIN}/api/teams/${team.id}`, { method: 'DELETE', headers: auth });
    }
  } catch {
    /* le compte part quand même : mieux vaut un objet orphelin qu'un compte résiduel */
  }
}

/**
 * Annule les créneaux que le scénario a laissés ouverts.
 *
 * ⚠️ Obligatoire depuis [BX-DEL], et l'ORDRE l'est aussi : une équipe engagée dans un match
 * non terminé ne se dissout pas (409 `team_engaged_in_match`), et un compte aligné dans un
 * tel match ne se supprime pas (409 `engaged_in_match`). Le nettoyage suit donc exactement
 * le parcours de sortie imposé aux vrais utilisateurs — matchs, puis équipes, puis compte.
 * Sans ça, `teams-matchmaking` (qui ouvre 5 slots) laissait ses comptes en base à chaque run.
 */
async function purgeUserMatches(user) {
  const auth = { authorization: `Bearer ${user.accessToken}` };
  try {
    const res = await fetch(`${ORIGIN}/api/matches/me`, { headers: auth });
    if (!res.ok) return;
    const { matches = [] } = await res.json();
    for (const match of matches) {
      // `DELETE /matches/:id` n'annule qu'un slot encore annulable ; sur les autres il
      // répond 4xx, ce qui est sans conséquence ici (on nettoie au mieux).
      await fetch(`${ORIGIN}/api/matches/${match.id}`, { method: 'DELETE', headers: auth });
    }
  } catch {
    /* même philosophie que purgeUserTeams : on tente, on ne bloque pas le nettoyage */
  }
}

/** Sans ça la base de dev accumule un compte + ses équipes à chaque exécution. */
async function deleteAuditUser(user) {
  await purgeUserMatches(user);
  await purgeUserTeams(user);
  try {
    const res = await fetch(`${ORIGIN}/api/users/me`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({ password: user.password }),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- exécution

/**
 * FX-FOCUS — où le focus a-t-il atterri, et qu'a-t-on annoncé ?
 *
 * `<body>` est la réponse FAUSSE : c'est ce que fait le `<dialog>` natif quand l'élément
 * qui l'a ouvert n'existe plus, et l'utilisateur au clavier est alors renvoyé en haut de
 * page. On lit aussi les régions live, parce qu'un focus déplacé sans rien annoncer laisse
 * un lecteur d'écran muet sur ce qui vient de disparaître.
 *
 * ⚠️ `role` et `name` sont rendus EN PLUS de `tag` : une assertion sur le seul `tag`
 * (« c'est un DIV ») est satisfaite par n'importe quel conteneur de la page et ne prouve
 * donc rien d'autre que « pas BODY ».
 */
/**
 * Attend qu'une annonce PRÉCISE soit écrite dans la région live, puis rend la main.
 *
 * ⚠️ POURQUOI CE HELPER EXISTE — c'est le piège le plus coûteux du harnais, rencontré DEUX
 * fois (`ft1c` 4.1b, `teams-manage` B13c-bis) : depuis FX-FOCUS il y a UNE région live
 * `role="status"` par écran, et elle est **montée en permanence**. Donc :
 *   - `locator('[role=status]').waitFor()` rend la main IMMÉDIATEMENT — on lit une région
 *     encore vide, ou pire, l'annonce PRÉCÉDENTE, et le check est un faux rouge (ou un faux
 *     vert) selon le sens du test ;
 *   - `focusLanding()` est un INSTANTANÉ synchrone : il ne contient aucune attente, ni pour
 *     le focus ni pour l'annonce. Il faut donc appeler CE helper AVANT lui.
 * Les deux bugs ont survécu longtemps parce que la course se gagnait tant que la campagne
 * dormait entre scénarios (quotas de rate-limit). RATE_LIMIT_FACTOR a supprimé ce sommeil et
 * les a fait tomber d'un coup : ce n'était pas une régression, c'était une course latente.
 *
 * `.catch()` volontaire : un timeout doit produire le ROUGE DU CHECK avec le texte réellement
 * lu — jamais une exception qui avorte la phase et masque tout ce qui suit.
 *
 * @param {string} text fragment attendu (sous-chaîne, pas une regex)
 * @returns {Promise<boolean>} true si l'annonce est arrivée dans le délai
 */
async function awaitAnnouncement(page, text, timeout = 15000) {
  return page
    .locator('[role="status"]', { hasText: text })
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * Attend que le focus ait QUITTÉ `<body>`, puis rend la main. Compagnon obligatoire de
 * `focusLanding()` après une action qui déplace le focus.
 *
 * ⚠️ MÊME PIÈGE QUE `awaitAnnouncement`, et il a mordu une troisième fois : la restauration
 * du focus (FX-FOCUS) se fait APRÈS le rendu qui suit la mutation. Entre l'annonce — déjà
 * écrite — et le focus posé, il y a une fenêtre où `document.activeElement` vaut encore
 * `<body>`. `focusLanding()` étant un instantané, il lit ce `<body>` et le check rougit
 * alors que l'application est correcte. Vécu sur `teams-invitations` I6-bis, apparu le jour
 * où la base de dev a été peuplée : plus de données -> rendu plus lent -> fenêtre plus large.
 *
 * ⚠️ Attendre ici ne masque PAS un vrai défaut : si l'app ne restaure jamais le focus, on
 * atteint le timeout, `focusLanding()` lit `<body>` et le check rougit — comme il le doit.
 *
 * ⚠️ PLAFOND À 15 s, PAS 5 (relevé pendant [FT-4B]). Le 5 s tenait en isolation mais tombait
 * en CAMPAGNE — `I6-bis` sortait rouge 2 fois sur 3 sur un fichier intact depuis FT-3, et vert
 * à chaque exécution filtrée. C'est le symptôme décrit juste au-dessus, aggravé par tout ce qui
 * ralentit un rendu de fin de campagne (base peuplée, 13 scénarios à la suite). Relever le
 * plafond ne coûte RIEN quand le focus arrive vite : `waitForFunction` rend la main dès que le
 * prédicat est vrai, jamais au bout du délai. Et ça ne masque toujours pas un vrai défaut, pour
 * la raison écrite ci-dessus. ⚠️ Un critère « campagne verte » non déterministe est pire qu'un
 * critère strict : personne ne peut plus distinguer « mon ticket a cassé quelque chose » de
 * « c'est encore I6-bis ».
 *
 * ⚠️ MAIS un plafond relevé sans mesure est un cache-misère : à 15 s, « le focus arrive en
 * 200 ms » et « le focus arrive en 9 s » sont le MÊME vert, alors que le second est un défaut.
 * D'où la trace ci-dessous. Elle ne fait PAS rougir — un seuil de latence figé en dur rendrait
 * la campagne dépendante de la charge de la machine, ce qui est exactement le non-déterminisme
 * qu'on vient de chasser — elle rend seulement visible ce que le vert cachait. Si elle se met à
 * sortir régulièrement, c'est l'application qu'il faut regarder, pas le plafond qu'il faut
 * remonter une fois de plus.
 */
const SLOW_FOCUS_MS = 1000;

async function awaitFocusRestored(page, timeout = 15000) {
  const startedAt = Date.now();
  return page
    .waitForFunction(
      () => {
        // ⚠️ « Le focus a quitté BODY » NE SUFFIT PAS, et c'est ce qui a fait de `I6-bis` de
        // `teams-invitations` une pièce à pile ou face pendant des mois : rouge en campagne,
        // vert en isolation. Mécanisme : l'application pose bien le focus, puis un rendu
        // SUIVANT (une requête de fond qui atterrit, le rail social qui se réactualise)
        // démonte l'élément et le focus retombe sur BODY le temps d'une frame. Cette fonction
        // rendait la main sur ce premier échantillon, et `focusLanding()` — un instantané —
        // lisait le creux.
        // On exige donc que le focus soit HORS de BODY sur trois frames CONSÉCUTIVES.
        // 🔑 Ça ne masque aucun vrai défaut : si l'application ne restaure jamais le focus, ou
        // le perd durablement, le compteur ne monte jamais à 3, on atteint le délai, et
        // `focusLanding()` lit BODY — le check rougit, comme il le doit.
        const stable = 3;
        if (!window.__auditFocusStreak) window.__auditFocusStreak = 0;
        const el = document.activeElement;
        window.__auditFocusStreak = el && el.tagName !== 'BODY' ? window.__auditFocusStreak + 1 : 0;
        return window.__auditFocusStreak >= stable;
      },
      null,
      { timeout, polling: 'raf' },
    )
    .then(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > SLOW_FOCUS_MS) {
        console.log(`  ⏱  focus restauré en ${elapsed} ms (> ${SLOW_FOCUS_MS} ms) — vert, mais lent`);
      }
      return true;
    })
    .catch(() => false);
}

/**
 * ⚠️ INSTANTANÉ, sans aucune attente : `activeElement` et le texte des régions live sont lus
 * À CET INSTANT. Si l'annonce attendue est produite par l'action qu'on vient de déclencher,
 * appeler `awaitAnnouncement()` AVANT (elle ne déplace pas le focus, elle ne fausse donc pas
 * la mesure).
 */
async function focusLanding(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const name = (node) => {
      if (!node) return '';
      const labelled = node.getAttribute('aria-labelledby');
      const target = labelled ? document.getElementById(labelled) : null;
      return (
        node.getAttribute('aria-label') ||
        (target ? target.textContent : '') ||
        node.textContent ||
        ''
      )
        .trim()
        .slice(0, 60);
    };
    return {
      tag: el ? el.tagName : null,
      role: el ? el.getAttribute('role') : null,
      id: el ? el.id : null,
      label: name(el),
      live: Array.from(document.querySelectorAll('[role="status"]'))
        .map((n) => (n.textContent || '').trim())
        .filter(Boolean),
    };
  });
}

/**
 * Active un élément AU CLAVIER — `focus()` puis Entrée, jamais un clic.
 *
 * La restauration du focus ne se juge que sur un parcours clavier : à la souris, le focus
 * de départ n'est pas sur le bouton, donc l'endroit où il atterrit ne veut rien dire.
 */
async function pressEnterOn(locator) {
  await locator.focus();
  await locator.page().keyboard.press('Enter');
}

export async function runScenario(scenario) {
  const fixtures = makeFixtures();
  // Créé même pour un scénario public : `/register` a besoin d'un email DÉJÀ pris pour
  // provoquer son 409, et le compte sert de repli si le scénario décide de se connecter.
  const users = [await createAuditUser()];
  const user = users[0];

  let phase = 'démarrage';
  const events = [];
  const steps = [];
  /**
   * Échecs réseau dont le scénario est VENU CHERCHER l'erreur (écran 404 d'une ressource
   * inexistante). Le navigateur logge « Failed to load resource » pour tout fetch non-2xx :
   * sans cette déclaration, un scénario qui teste un état d'erreur ne pourrait jamais
   * sortir 0. Les entrées restent AFFICHÉES dans le rapport, dans leur propre section —
   * on distingue « provoqué » de « subi », on ne masque rien.
   */
  const expectedFailures = [];
  /**
   * Deux garde-fous, parce qu'`expectHttp` est le seul mécanisme capable de faire taire le
   * filet et qu'un mécanisme trop large ne protège plus rien :
   *   - SEULS ces flux sont exemptables. `record()` est partagé par tous les flux, donc sans
   *     ce filtre une exception non attrapée ou un console.error dont le message contient
   *     l'URL visée serait exempté lui aussi — un « Uncaught Error: failed to load
   *     /api/teams/<uuid> » sortirait vert.
   *   - l'exemption ne vaut que dans la PHASE où elle a été déclarée, sinon elle court
   *     jusqu'à la fin du run et couvre en silence des surfaces qu'on n'a pas voulu couvrir
   *     (un même uuid réutilisé comme matchId dans une phase suivante, par exemple).
   */
  const EXPECTABLE_KINDS = new Set(['http', 'netfail', 'browser']);
  /**
   * Chrome remonte UN MÊME échec de ressource sur DEUX flux : `Log.entryAdded` (kind
   * `browser`) et l'API console (kind `console`). Refuser tout `console` rendrait donc
   * `expectHttp` inopérant sur la moitié des entrées — mesuré : 4 exemptées, 2 imputées à
   * tort. On accepte donc le flux console UNIQUEMENT sur la signature du navigateur ; un
   * `console.error` écrit par notre code reste imputé au ticket, même s'il cite l'URL visée.
   */
  const BROWSER_RESOURCE_ERROR = /^Failed to load resource/i;
  const isExpectable = (kind, text) =>
    EXPECTABLE_KINDS.has(kind) || (kind === 'console' && BROWSER_RESOURCE_ERROR.test(text));

  const setPhase = (p) => {
    phase = p;
  };
  const step = (id, ok, detail) => {
    steps.push({ id, ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} ${id} — ${detail}`);
  };

  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // Reproduit l'exception de certificat que l'humain pose à la main : sans elle, le
  // cert auto-signé noierait tout le reste sous des ERR_CERT_AUTHORITY_INVALID.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const record = (kind, level, text, extra = {}) => {
    const haystack = `${extra.url ?? ''} ${text}`;
    const declared = isExpectable(kind, text)
      ? expectedFailures.find((f) => f.phase === phase && f.pattern.test(haystack))
      : undefined;
    if (declared) declared.hits += 1;
    events.push({ phase, kind, level, text, ...extra, expected: declared?.reason });
  };

  page.on('console', (msg) => {
    const loc = msg.location();
    record('console', msg.type(), msg.text(), {
      url: loc.url ? `${loc.url}:${loc.lineNumber}` : undefined,
    });
  });

  // Un alert()/confirm() natif FIGE un navigateur piloté : sans ce handler, tout scénario
  // qui touche /teams/:id resterait bloqué jusqu'au timeout. On l'ENREGISTRE au passage —
  // une boîte native non stylée dans une app notée est une trouvaille, pas un détail.
  let dialogResponse = 'dismiss';
  page.on('dialog', (dialog) => {
    record('dialog', 'warning', `${dialog.type()}() natif : « ${dialog.message()} »`);
    void (dialogResponse === 'accept' ? dialog.accept() : dialog.dismiss());
  });
  page.on('pageerror', (err) => record('exception', 'error', err.message));
  page.on('requestfailed', (req) =>
    record('netfail', 'error', req.failure()?.errorText ?? 'failed', { url: req.url() }),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) record('http', 'error', `HTTP ${res.status()}`, { url: res.url() });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Log.enable');
  await cdp.send('Runtime.enable');
  cdp.on('Log.entryAdded', ({ entry }) =>
    record('browser', entry.level, entry.text, { url: entry.url, source: entry.source }),
  );

  /** Compte les requêtes émises pendant `fn` : sert à prouver qu'une validation
   *  CLIENT n'a déclenché AUCUN aller-retour réseau. `filter` restreint le comptage
   *  à une famille d'URL (sinon on compterait aussi les chunks Vite du HMR). */
  const countRequests = async (fn, filter = () => true) => {
    let n = 0;
    const spy = (req) => {
      if (filter(req.url())) n++;
    };
    page.on('request', spy);
    try {
      await fn();
    } finally {
      page.off('request', spy);
    }
    return n;
  };

  /**
   * Connexion par l'UI, étiquetée hors périmètre : ce parcours n'est pas l'objet du run.
   *
   * ⚠️ ON ATTEND LA QUIESCENCE RÉSEAU, PAS SEULEMENT L'URL — et ce n'est pas de la prudence
   * gratuite. `waitForURL` rend la main dès que la route a changé, alors que `/home` vient de
   * lancer ses requêtes ; le `page.goto` que l'appelant enchaîne aussitôt les AVORTE, et
   * Playwright émet un `requestfailed` (`net::ERR_ABORTED`) que le runner enregistre en
   * `netfail`. Comme il tombe après le `setPhase` du scénario, il est imputé à un ticket
   * innocent. Tant que `/home` était un stub sans aucune requête, cette attente ne servait à
   * rien ; depuis [F-HOME] c'est une vraie page (5 requêtes), et 5 scénarios appellent `login()`
   * juste avant de naviguer.
   *
   * L'attente reste DANS la phase « login », donc tout ce qu'elle capte reste hors périmètre.
   */
  const login = async (as = user) => {
    setPhase('login (hors périmètre)');
    await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', as.email);
    await page.fill('#password', as.password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL('**/home', { timeout: 15000 });
    // `catch` : une page qui ne se calme jamais ne doit pas faire sortir le harnais en exit 2
    // sur une étape hors périmètre — au pire on retombe sur le comportement d'avant.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  };

  let crashed = null;
  try {
    // Un scénario PUBLIC (`export const auth = false`) doit rester déconnecté : `/`,
    // `/login` et `/register` redirigent vers `/home` dès qu'une session existe, et
    // l'audit ne verrait jamais l'écran qu'il prétend auditer.
    if (scenario.auth !== false) {
      setPhase('session (hors périmètre)');
      if (user.cookies.length === 0) throw new Error("register n'a posé aucun cookie de refresh");
      await context.addCookies(user.cookies);
      await page.goto(`${ORIGIN}/home`, { waitUntil: 'networkidle' });
      // Sans cette garde, un cookie mal injecté ferait rebondir le scénario sur `/` et on
      // auditerait la landing en croyant auditer une page authentifiée.
      if (!page.url().includes('/home')) {
        throw new Error(`session non ouverte : la navigation a fini sur ${page.url()}`);
      }
    }

    await scenario.run({
      page,
      setPhase,
      step,
      countRequests,
      fixtures,
      user,
      ORIGIN,
      login,
      // ⚠️ `focusLanding` est un INSTANTANÉ : après une action qui déplace le focus,
      // appeler `awaitFocusRestored()` avant lui (voir son docblock).
      focusLanding: () => focusLanding(page),
      awaitFocusRestored: (timeout) => awaitFocusRestored(page, timeout),
      // ⚠️ À appeler avant TOUTE lecture d'une région live (dont `focusLanding`). Voir son
      // docblock : la région est montée en permanence, attendre sa présence n'attend rien.
      awaitAnnouncement: (text, timeout) => awaitAnnouncement(page, text, timeout),
      pressEnterOn,
      // Compte supplémentaire (ajout de membre, conflit de pseudo) — supprimé lui aussi.
      createUser: async () => {
        const extra = await createAuditUser(`x${users.length}`);
        users.push(extra);
        return extra;
      },
      // 'accept' pour traverser un window.confirm, 'dismiss' pour l'annuler.
      setDialogResponse: (mode) => {
        dialogResponse = mode;
      },
      /**
       * Déclare qu'un échec RÉSEAU est l'OBJET du test (id inexistant -> écran 404).
       * ⚠️ Trois règles :
       *   1. le motif doit viser l'URL précise testée, jamais une route entière — sinon il
       *      masquerait de vrais 4xx de la même famille ;
       *   2. à appeler APRÈS le `setPhase` de la phase concernée et AVANT l'action :
       *      l'exemption ne vaut que dans cette phase ;
       *   3. seuls les flux réseau sont exemptables — une exception ou un `console.*` reste
       *      imputé au ticket même si son message contient l'URL visée.
       * Un motif qui ne sert jamais est signalé dans le rapport (faute de frappe silencieuse).
       */
      expectHttp: (pattern, reason) => {
        expectedFailures.push({ pattern, reason, phase, hits: 0 });
      },
      // À appeler AVANT toute soumission du formulaire d'inscription : le quota est
      // partagé avec les comptes créés par le runner, et un 429 fausserait le rapport.
      awaitRegisterSlot,
      /**
       * Requête SQL dans le conteneur postgres — la seule sortie du navigateur du harnais.
       * ⚠️ Réservé à FORCER un état que l'API interdit d'atteindre (et au teardown qui en
       * découle) ; jamais à constater un comportement applicatif. Voir le docblock de
       * `sql.mjs`, qui porte la règle et les deux pièges de psql.
       */
      sql,
    });
  } catch (err) {
    crashed = err;
  } finally {
    await browser.close();
    const leftovers = [];
    for (const u of users) {
      if (!(await deleteAuditUser(u))) leftovers.push(u.email);
    }
    rmSync(fixtures.dir, { recursive: true, force: true });
    if (leftovers.length > 0) {
      console.log(
        `\n⚠️  compte(s) NON supprimé(s) — à nettoyer à la main : ${leftovers.join(', ')}`,
      );
    }
  }

  return { events, steps, crashed, user, expectedFailures };
}

// ---------------------------------------------------------------- rapport

export function report(scenario, { events, steps, crashed, expectedFailures = [] }) {
  const excusable = STRICT ? OUT_OF_SCOPE.filter((k) => k.tooling) : OUT_OF_SCOPE;
  const label = (e) => {
    const known = excusable.find((k) => k.match.test(e.text) || k.match.test(e.url ?? ''));
    return known ?? null;
  };
  const fmt = (e) => `[${e.level}] ${e.text}${e.url ? ` (${e.url.replace(ORIGIN, '')})` : ''}`;

  const scoped = events.filter((e) => !e.phase.startsWith('login'));
  // `e.expected` = échec réseau déclaré par le scénario via expectHttp() : c'est l'état
  // d'erreur qu'on teste, pas du bruit. Listé plus bas, jamais masqué.
  const blaming = scoped.filter((e) => !label(e) && !e.expected);

  console.log('\n' + '='.repeat(78));
  console.log(
    `CONSOLE — ${scenario.name}${STRICT ? '   [MODE STRICT : dette héritée comptée]' : ''}`,
  );
  console.log('='.repeat(78));

  if (blaming.length === 0) {
    console.log('\n✅ Aucune entrée imputable au périmètre du ticket.');
  } else {
    console.log(`\n❌ ${blaming.length} entrée(s) imputable(s) au ticket :`);
    const seen = new Map();
    for (const e of blaming) {
      const key = `${e.phase} :: ${fmt(e)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [text, n] of seen) console.log(`   ${n > 1 ? `${n}× ` : ''}${text}`);
  }

  const provoked = new Map();
  for (const e of scoped) {
    if (!e.expected) continue;
    provoked.set(e.expected, (provoked.get(e.expected) ?? 0) + 1);
  }
  if (provoked.size > 0) {
    console.log('\nErreurs réseau PROVOQUÉES par le scénario (état d’erreur testé) :');
    for (const [reason, n] of provoked) console.log(`   ${n}× ${reason}`);
  }

  // Un motif expectHttp() qui n'a jamais matché est presque toujours une faute de frappe ou
  // une phase qui a bougé. Il échoue du bon côté (rouge), mais en silence : on le dit.
  const unused = expectedFailures.filter((f) => f.hits === 0);
  if (unused.length > 0) {
    console.log('\n⚠️  Motif(s) expectHttp() jamais déclenché(s) — motif ou phase à revoir :');
    for (const f of unused) console.log(`   ${f.pattern} (phase « ${f.phase} ») : ${f.reason}`);
  }

  // La dette connue est AFFICHÉE, jamais masquée : c'est ce qui l'empêche de pourrir.
  const debt = new Map();
  for (const e of events) {
    const known = label(e);
    if (!known) continue;
    const k = `${known.owner} — ${known.reason}`;
    debt.set(k, (debt.get(k) ?? 0) + 1);
  }
  if (debt.size > 0) {
    console.log('\nDette connue, hors périmètre de ce ticket :');
    for (const [text, n] of debt) console.log(`   ${n}× ${text}`);
  }

  const failed = steps.filter((s) => !s.ok);
  console.log('\n' + '-'.repeat(78));
  console.log(`CHECKS  : ${steps.length - failed.length}/${steps.length} verts`);
  console.log(`CONSOLE : ${blaming.length} entrée(s) à corriger`);
  console.log('-'.repeat(78));

  if (crashed) {
    console.error(`\n💥 le scénario s'est interrompu : ${crashed.message}`);
    return 2;
  }
  return failed.length === 0 && blaming.length === 0 ? 0 : 1;
}
