"""AUTH — contrat de `POST /auth/register` et `POST /auth/login`, rate limit COMPRIS.

Pourquoi cette suite existe : `helpers.register()` sème ses users en SQL pour ne pas payer
~15 min de rate-limit par run. Les deux routes d'auth n'étaient donc plus couvertes du tout.
Elles le sont ICI, par la vraie route.

⚠️ ARITHMÉTIQUE DES QUOTAS — la structure de cette suite n'est PAS cosmétique. Les deux
routes ont des compteurs SÉPARÉS, ce qui permet de tenir les deux 429 SANS AUCUNE ATTENTE :

    register (3/min/IP) : 3 appels utiles, le 4e EST l'assertion du 429.
    login    (5/min/IP) : 5 appels utiles, le 6e EST l'assertion du 429.

Tout tient donc dans UNE fenêtre par route. C'est ce qui a dicté deux compressions :
  · les trois règles Zod (pseudo court, email invalide, mot de passe faible) sont testées en
    UN SEUL appel — `z.object` renvoie TOUTES les issues, on assert sur les 3 chemins ;
  · l'inscription nominale se fait avec un email en CASSE MIXTE, ce qui prouve le
    `toLowerCase` sans dépenser un appel de plus.
⚠️ Un 400 (Zod) et un 409 CONSOMMENT du quota : le compteur s'incrémente dans un hook
`onRequest`, AVANT le handler. Vérifié : trois corps vides d'affilée donnent 400,400,400
puis 429. Ajouter un appel décale tout et rend la suite rouge — refaire le compte d'abord.

⚠️ ORDRE DES SECTIONS : l'équivalence SQL passe AVANT le bloc login, pour que les deux users
comparés soient encore INTACTS. Aujourd'hui `login` n'écrit rien (JWT stateless, pas de table
de session, pas de colonne `last_login_at`), mais le jour où ce ne sera plus vrai, ce cas
resterait juste. Ne pas le déplacer après le login pour « regrouper le SQL ».
"""

import time
import uuid

from helpers import FIXTURE_PASSWORD, Suite, forge_temp_token, register, req, sql

WINDOW = 61  # 60 s + marge : la fenêtre du limiteur est fixe (continueExceeding = false)

_REFS = None  # cache des FK vers users : une seule requête pour toute la suite


def _new(tag="alice"):
    u = uuid.uuid4().hex[:8]
    return f"{tag}{u}", f"{tag}{u}@t.io"


def _retry_if_cold(label, fn):
    """Premier appel d'une fenêtre. Si un run PRÉCÉDENT a vidé le quota il y a moins d'une
    minute (suite relancée à la main deux fois de suite), on attend UNE fois. Dans un
    `run_all.py` normal ça ne se déclenche jamais : c'est un filet, pas une attente de régime."""
    st, b = fn()
    if st == 429:
        print(f"   ⏳ quota {label} encore chaud d'un run précédent — attente {WINDOW} s (une seule fois)")
        time.sleep(WINDOW)
        st, b = fn()
    return st, b


def _row_signature(uid):
    """Toutes les colonnes de `users` SAUF l'identité et les horodatages, en jsonb.

    En jsonb plutôt qu'en liste de colonnes choisies : une colonne AJOUTÉE plus tard apparaît
    ici toute seule. C'est ce qui fait de ce cas un vrai garde-fou et pas une photo figée.
    Exclusions et leur raison — `id`/`pseudo`/`email` (identité, différentes par construction),
    `password_hash` (bcrypt salé : deux hashs du même mot de passe diffèrent toujours),
    `created_at`/`updated_at` (horodatages)."""
    return sql(
        "select to_jsonb(u) - 'id' - 'pseudo' - 'email' - 'password_hash' - 'created_at' "
        f"- 'updated_at' from users u where id = '{uid}';"
    )


def _side_effects(uid):
    """Pour CHAQUE table qui référence users(id), le nombre de lignes pointant sur cet user.

    C'est le trou que ce cas bouche : si `POST /auth/register` se met un jour à créer une
    ligne AILLEURS (préférences, ELO initial, profil par défaut, table de sessions), l'user
    semé par `helpers.register()` ne l'aura pas. Les suites casseraient loin d'ici, sans
    rapport apparent. La liste des tables est lue dans le catalogue postgres : une FK ajoutée
    demain est couverte sans toucher à ce fichier.

    ⚠️ Si ce cas devient rouge, c'est un VRAI positif : la bonne correction est de faire
    créer le même effet de bord par `helpers.register()`, PAS d'ajouter une exclusion ici."""
    global _REFS
    if _REFS is None:
        _REFS = [
            line.strip()
            for line in sql(
                "select c.relname || '.' || a.attname from pg_constraint co "
                "join pg_class c on c.oid = co.conrelid "
                "join pg_attribute a on a.attrelid = c.oid and a.attnum = co.conkey[1] "
                "where co.contype = 'f' and co.confrelid = 'users'::regclass "
                "and array_length(co.conkey, 1) = 1 order by 1;"
            ).splitlines()
            if line.strip()
        ]
    if not _REFS:
        return "AUCUNE FK vers users — schéma inattendu"
    parts = []
    for ref in _REFS:
        table, col = ref.split(".", 1)
        parts.append(f"select '{ref}' as ref, count(*)::text as n from {table} where {col} = '{uid}'")
    return sql(" union all ".join(parts) + " order by ref;").replace("\n", " / ")


def run():
    s = Suite("AUTH — contrat register/login + rate limit (429 réels)")

    pseudo, email = _new()

    # ── register : 3 appels utiles, le 4e est l'assertion ───────────────────────────────
    s.section("POST /auth/register — contrat")
    st, b = _retry_if_cold(
        "register",
        lambda: req(
            "POST",
            "/auth/register",
            # Email en CASSE MIXTE : prouve le `.toLowerCase()` de Zod sans dépenser un appel.
            body={"pseudo": pseudo, "email": email.upper(), "password": FIXTURE_PASSWORD},
        ),
    )
    s.check("inscription valide → 201", st, 201, b.get("error", ""))
    s.check("un accessToken est renvoyé", bool(b.get("accessToken")), True)
    user = b.get("user") or {}
    s.check("l'user renvoyé porte un id", bool(user.get("id")), True)
    s.check("email normalisé en minuscules", user.get("email"), email.lower())
    s.check("projection : pas de passwordHash", "passwordHash" in user, False)
    s.check("projection : pas de totpSecret", "totpSecret" in user, False)
    # Le token de la ROUTE doit ouvrir une route authentifiée, comme celui de la sentinelle :
    # c'est ce qui relie les deux chemins de création d'user.
    st, me = req("GET", "/users/me", b.get("accessToken"))
    s.check("le token de register ouvre GET /users/me", st, 200)
    s.check("… et pointe sur le bon user", (me.get("user") or {}).get("id"), user.get("id"))

    # Les 3 règles Zod en UN appel : z.object collecte toutes les issues, il n'y a pas de
    # court-circuit au premier champ invalide.
    st, b = req("POST", "/auth/register", body={"pseudo": "ab", "email": "pas-un-email", "password": "test"})
    s.check("pseudo court + email invalide + mdp faible → 400", st, 400)
    s.check(
        "… et les 3 champs sont signalés",
        sorted({i["path"][0] for i in b.get("errors", []) if i.get("path")}),
        ["email", "password", "pseudo"],
    )

    st, _ = req("POST", "/auth/register", body={"pseudo": pseudo, "email": _new()[1], "password": FIXTURE_PASSWORD})
    s.check("pseudo déjà pris → 409", st, 409)

    s.section("POST /auth/register — le rate limit (3/min par IP)")
    _, refuse = _new("carol")
    st, b = req(
        "POST",
        "/auth/register",
        body={"pseudo": _new("carol")[0], "email": refuse, "password": FIXTURE_PASSWORD},
    )
    s.check("4e inscription dans la minute → 429", st, 429)
    s.check("… avec le corps standard du limiteur", b.get("error"), "Too Many Requests")

    # ── Le trou de la sentinelle : l'USER, pas le token ─────────────────────────────────
    # AVANT le bloc login : les deux users sont encore vierges de toute autre interaction.
    s.section("Équivalence : user semé (helpers) vs user inscrit (API)")
    _, seed_id, seed_pseudo = register("erin")
    api_id = user.get("id")
    s.check(
        "mêmes colonnes (hors identité et horodatages)",
        _row_signature(seed_id),
        _row_signature(api_id),
        "⚠️ si rouge : POST /auth/register pose désormais un champ que helpers.register() ne pose pas.",
    )
    s.check(
        "les deux ont bien un password_hash",
        sql(f"select (password_hash is not null) from users where id in ('{api_id}','{seed_id}');").replace("\n", "/"),
        "t/t",
    )
    s.check(
        "aucun effet de bord dans une autre table (ELO, préférences, sessions…)",
        _side_effects(seed_id),
        _side_effects(api_id),
        "⚠️ si rouge : register crée une ligne ailleurs — helpers.register() doit la créer aussi.",
    )

    # ── login : compteur SÉPARÉ, donc aucune attente. 5 appels utiles, le 6e assert ──────
    s.section("POST /auth/login — contrat (5/min par IP)")
    st, b = _retry_if_cold(
        "login", lambda: req("POST", "/auth/login", body={"email": email, "password": FIXTURE_PASSWORD})
    )
    s.check("login valide → 200", st, 200, b.get("error", ""))
    s.check("un accessToken est renvoyé", bool(b.get("accessToken")), True)
    st, me = req("GET", "/users/me", b.get("accessToken"))
    s.check("le token de login ouvre GET /users/me", st, 200)

    # Un user SEMÉ doit pouvoir se logger : prouve que FIXTURE_HASH est un vrai hash bcrypt
    # de FIXTURE_PASSWORD (cost 12, comme hashPassword), et au passage le toLowerCase du login.
    st, _ = req("POST", "/auth/login", body={"email": f"{seed_pseudo}@t.io".upper(), "password": FIXTURE_PASSWORD})
    s.check("user semé en SQL + email en MAJUSCULES → 200", st, 200)

    st, _ = req("POST", "/auth/login", body={"email": email, "password": "Mauvais1234!"})
    s.check("mauvais mot de passe → 401", st, 401)

    # Deux assertions pour une requête : l'email inconnu est CELUI que le 429 a refusé plus
    # haut. Si le 429 avait quand même créé l'user, on aurait 200 ici.
    st, _ = req("POST", "/auth/login", body={"email": refuse, "password": FIXTURE_PASSWORD})
    s.check("email inconnu → 401 (et l'inscription refusée par le 429 n'a rien créé)", st, 401)

    st, _ = req("POST", "/auth/login", body={"email": email})
    s.check("corps incomplet → 400", st, 400)

    s.section("POST /auth/login — le rate limit (5/min par IP)")
    st, b = req("POST", "/auth/login", body={"email": email, "password": FIXTURE_PASSWORD})
    s.check("6e tentative dans la minute → 429", st, 429)
    s.check("… avec le corps standard du limiteur", b.get("error"), "Too Many Requests")

    # ── B12 — le compteur de /auth/2fa/verify est-il indexé sur le COMPTE ? ─────────────
    # Ce que ce bloc prouve et que l'unitaire ne PEUT pas prouver : que le générateur de clé
    # est réellement APPELÉ, sur le bon compteur, à un moment du cycle de vie où le tempToken
    # est lisible (il ne l'est pas en `onRequest`, le corps n'y est pas encore décodé). Un
    # `keyGenerator` parfait mais jamais branché passe tous les cas unitaires.
    #
    # Aucun user créé : un tempToken forgé sur un uuid inexistant rend 401 (user introuvable)
    # tout en étant COMPTÉ — c'est exactement la mesure qu'on veut.
    #
    # ⚠️ ARITHMÉTIQUE — la route a DEUX compteurs (cf. `routes/auth/2fa.ts`) : un plancher
    # par IP à 30/min et le compteur par compte à 5/min. Ce bloc dépense 7 requêtes, donc
    # reste très en dessous du plancher : tout 429 observé ici vient forcément du compteur
    # par compte. Ajouter des appels ici change ce raisonnement — refaire le compte d'abord.
    s.section("POST /auth/2fa/verify — le compteur est-il par COMPTE (B12) ?")
    victim, other = str(uuid.uuid4()), str(uuid.uuid4())
    for _ in range(6):
        st, _ = req(
            "POST",
            "/auth/2fa/verify",
            body={"tempToken": forge_temp_token(victim), "code": "000000"},
        )
    s.check(
        "6e essai sur le même compte → 429",
        st,
        429,
        "⚠️ si 401 : le compteur par compte n'est pas branché (5/min attendu).",
    )
    # ⚠️ NE PAS SUPPRIMER l'assertion qui suit en croyant faire du ménage : c'est ELLE qui
    # discrimine. Le 429 ci-dessus serait vert sur master aussi (master bornait à 5/min par
    # IP, donc la 6e requête d'une même machine y donnait déjà 429) — c'est « un autre compte
    # depuis la même IP » qui est ROUGE sur master et vert ici.
    # Chaque essai ci-dessus utilisait un tempToken DIFFÉRENT (forgé à chaque tour) : le 429
    # prouve donc aussi que le compteur suit le COMPTE, et pas un token particulier.
    st, _ = req(
        "POST", "/auth/2fa/verify", body={"tempToken": forge_temp_token(other), "code": "000000"}
    )
    s.check(
        "un AUTRE compte, MÊME IP, garde son quota → 401",
        st,
        401,
        "⚠️ si 429 : la clé est retombée sur l'IP — c'est exactement le bug que B12 corrige.",
    )

    # ── La clé du compteur GLOBAL est-elle vraiment l'utilisateur ? ─────────────────────
    # Ces deux cas ne sont pas décoratifs. `rateLimitKey` ne peut lire `request.user` que si
    # le hook du limiteur passe APRÈS `authenticate`. C'est démontré pour les routes qui
    # déclarent leur propre quota (le plugin POUSSE son hook en fin de tableau `onRequest`)
    # — mais l'enregistrement GLOBAL passe par une autre branche du `onRoute` du plugin. Si
    # cette branche s'exécutait plus tôt, `request.user` serait vide, tout retomberait sur
    # l'IP, et RIEN NE LE DIRAIT : les suites passeraient quand même, simplement parce que
    # 100/min par IP suffit. On teste donc la seule chose qui distingue les deux montages.
    #
    # `GET /users/me` est choisie parce qu'elle ne déclare AUCUN quota propre : elle emprunte
    # donc exactement le chemin global qu'on veut prouver.
    s.section("Rate limit global : la clé est-elle l'utilisateur, ou l'IP ?")
    tokX, _, _ = register("bob")
    tokY, _, _ = register("carol")

    st, n = 200, 0
    while st == 200 and n < 150:
        st, _ = req("GET", "/users/me", tokX)
        n += 1
    s.check("un user seul finit par saturer le quota global → 429", st, 429, f"après {n} requêtes")
    # ⚠️ Ce cas NE prouve PAS le keying : il passe aussi bien en per-IP (mesuré n=98) qu'en
    # per-user (n=101). Il ne sert qu'à détecter un changement accidentel de `max: 100`.
    # La preuve du keying, ce sont les DEUX cas suivants.
    s.check("garde-fou de régression sur `max: 100` (PAS une preuve de keying)", 95 <= n <= 105, True, f"n={n}")

    st, _ = req("GET", "/users/me", tokY)
    s.check(
        "un AUTRE user, MÊME IP, n'est pas affecté → 200",
        st,
        200,
        "⚠️ si 429 : le keyGenerator global ne voit pas request.user — on est retombé en per-IP.",
    )

    # Le repli anonyme : les requêtes sans token partagent un compteur, et ce compteur est
    # SÉPARÉ de celui d'un utilisateur authentifié.
    # ⚠️ Ce que ce cas NE prouve PAS : depuis une seule machine, « clé = IP » et « une unique
    # clé pour tous les anonymes » sont indiscernables (une seule IP source, et le backend
    # n'est pas en trustProxy). C'est la forme exacte de la clé qui est verrouillée en
    # unitaire, dans `tests/unit/rate-limit.test.ts`.
    st, n = 200, 0
    while st == 200 and n < 150:
        st, _ = req("GET", "/ping")
        n += 1
    s.check("les requêtes ANONYMES partagent bien un compteur → 429", st, 429, f"après {n} requêtes")
    st, _ = req("GET", "/users/me", tokY)
    s.check(
        "un user authentifié n'est PAS bloqué par le quota anonyme → 200",
        st,
        200,
        "⚠️ si 429 : anonymes et authentifiés partagent le même bucket.",
    )

    return s.report()


if __name__ == "__main__":
    run()
