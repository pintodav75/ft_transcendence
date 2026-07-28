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

export async function awaitRegisterSlot() {
  for (;;) {
    const now = Date.now();
    while (registerHits.length > 0 && now - registerHits[0] > 61_000) registerHits.shift();
    if (registerHits.length < 3) {
      registerHits.push(now);
      return;
    }
    const wait = 61_000 - (now - registerHits[0]);
    console.log(`   ⏳ quota register (3/min) atteint — attente de ${Math.ceil(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait + 250));
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

  /** Connexion par l'UI, étiquetée hors périmètre : ce parcours n'est pas l'objet du run. */
  const login = async (as = user) => {
    setPhase('login (hors périmètre)');
    await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', as.email);
    await page.fill('#password', as.password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL('**/home', { timeout: 15000 });
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
