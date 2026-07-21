"""GET /search — recherche globale par préfixe (joueurs + teams).

Suite écrite en réponse à la review : les cas passés « à la main » ne protègent de
rien une fois la session fermée. Ce qu'on verrouille ici, ce sont surtout les trois
propriétés qui étaient FAUSSES avant correction :

  1. le tri est GLOBAL — une team peut se placer avant un joueur, et inversement ;
  2. `limit` borne la LISTE FINALE (avant : jusqu'à 2 × limit, users puis teams) ;
  3. `offset` pagine la liste fusionnée (avant : deux paginations indépendantes).

Astuce d'isolation : toutes les assertions d'ordre portent sur un préfixe unique —
le pseudo complet d'alice, `alice<hex8>` — que rien d'autre dans la base ne peut
porter. Les alice/bob des autres suites ne polluent donc jamais ces cas.

Le jeu de données sous ce préfixe est construit pour forcer l'ENTRELACEMENT :

    team  "alice<h>"        <- même clé de tri que le joueur, 'team' < 'user' -> passe devant
    user  "alice<h>"
    team  "alice<h>Mid"
    team  "alice<h>Zeta"

Une team avant un joueur ET un joueur avant une team dans la même réponse : c'est
exactement ce qu'un tri « par source » ne peut pas produire.
"""

import uuid

from helpers import Suite, ladder_id, register, req

# ladders non-1v1 (une team = un ladder par capitaine) — assez pour tous les cas
L = [
    ("cs2", "2v2"),
    ("rl", "2v2"),
    ("val", "2v2"),
    ("rl", "3v3"),
    ("cs2", "5v5"),
    ("lol", "5v5"),
    ("val", "5v5"),
]


def mkteam(token, game, fmt, name):
    _, b = req("POST", "/teams", token, {"ladderId": ladder_id(token, game, fmt), "name": name})
    return (b.get("team") or {}).get("id")


def labels(body):
    """La liste des noms affichés, dans l'ordre rendu par l'API."""
    return [r.get("pseudo") if r["type"] == "user" else r.get("name") for r in body["results"]]


def kinds(body):
    return [r["type"] for r in body["results"]]


def run():
    s = Suite("SEARCH — GET /search (préfixe, filtre, tri global, pagination)")

    tokA, idA, pA = register("alice")  # pA = 'alice<hex8>' : notre préfixe isolant
    tokB, idB, pB = register("bob")
    tok = uuid.uuid4().hex[:8]

    T_EQ = mkteam(tokA, *L[0], pA)  # même clé de tri que le joueur
    T_MID = mkteam(tokA, *L[1], pA + "Mid")
    T_ZETA = mkteam(tokA, *L[2], pA + "Zeta")
    mkteam(tokA, *L[3], "İ" + tok + "pek")  # cas Unicode
    mkteam(tokA, *L[4], tok + "_x")  # cas échappement : '_' littéral
    mkteam(tokA, *L[5], tok + "Zx")  # le voisin que ni '_' ni '\' ne doivent attraper
    mkteam(tokA, *L[6], tok + "\\x")  # cas échappement : '\' littéral

    ORDER = [pA, pA, pA + "Mid", pA + "Zeta"]  # ordre global attendu
    KINDS = ["team", "user", "team", "team"]

    # ------------------------------------------------------------------ gardes
    s.section("Gardes et validation")
    st, _ = req("GET", f"/search?q={pA}")
    s.check("sans token → 401", st, 401)
    st, _ = req("GET", "/search?q=a", tokA)
    s.check("q d'un seul caractère → 400", st, 400)
    st, _ = req("GET", "/search", tokA)
    s.check("q absent → 400", st, 400)
    st, _ = req("GET", f"/search?q={pA}&limit=0", tokA)
    s.check("limit=0 → 400", st, 400)
    st, _ = req("GET", f"/search?q={pA}&limit=51", tokA)
    s.check("limit=51 (au-dessus du plafond) → 400", st, 400)
    st, _ = req("GET", f"/search?q={pA}&offset=-1", tokA)
    s.check("offset négatif → 400", st, 400)
    st, _ = req("GET", f"/search?q={pA}&type=guild", tokA)
    s.check("type hors enum → 400", st, 400)

    # --------------------------------------------------------------- tri global
    s.section("Tri GLOBAL sur la liste fusionnée (le bug de la review)")
    st, b = req("GET", f"/search?q={pA}&limit=50", tokA)
    s.check("200", st, 200)
    s.check("les 4 entités du préfixe sont là", len(b["results"]), 4)
    s.check("ordre alphabétique global", labels(b), ORDER)
    s.check("une team AVANT un joueur, et un joueur AVANT une team", kinds(b), KINDS)
    s.check("hasMore=false quand tout tient sur la page", b.get("hasMore"), False)

    # --------------------------------------------------------------- pagination
    s.section("Pagination sur la liste fusionnée")
    st, b = req("GET", f"/search?q={pA}&limit=2", tokA)
    s.check("limit=2 → EXACTEMENT 2 résultats (pas 2 par source)", len(b["results"]), 2)
    s.check("ce sont les 2 premiers du tri global", labels(b), ORDER[:2])
    s.check("hasMore=true", b.get("hasMore"), True)

    st, b = req("GET", f"/search?q={pA}&limit=1&offset=1", tokA)
    s.check("offset=1 → le 2e élément GLOBAL", labels(b), [ORDER[1]])
    s.check("…et c'est bien le joueur", kinds(b), ["user"])

    st, b = req("GET", f"/search?q={pA}&limit=1&offset=3", tokA)
    s.check("offset=3 → le dernier", labels(b), [ORDER[3]])
    s.check("dernière page → hasMore=false", b.get("hasMore"), False)

    st, b = req("GET", f"/search?q={pA}&limit=2&offset=4", tokA)
    s.check("offset au-delà du total → liste vide", b["results"], [])
    s.check("…et hasMore=false", b.get("hasMore"), False)

    seen = []
    for off in range(0, 4):
        _, page = req("GET", f"/search?q={pA}&limit=1&offset={off}", tokA)
        seen += labels(page)
    s.check("parcours page par page = la liste complète, sans trou ni doublon", seen, ORDER)

    # ------------------------------------------------------------------- filtre
    s.section("Filtre ?type=")
    st, b = req("GET", f"/search?q={pA}&type=user", tokA)
    s.check("type=user → uniquement des joueurs", kinds(b), ["user"])
    s.check("…le bon", labels(b), [pA])
    st, b = req("GET", f"/search?q={pA}&type=team", tokA)
    s.check("type=team → uniquement des teams", kinds(b), ["team", "team", "team"])
    s.check("…triées entre elles", labels(b), [pA, pA + "Mid", pA + "Zeta"])
    st, b = req("GET", f"/search?q={pA}&type=team&limit=1&offset=2", tokA)
    s.check("le filtre se pagine aussi", labels(b), [pA + "Zeta"])

    # ------------------------------------------------------- casse et Unicode
    s.section("Insensibilité à la casse (faite par Postgres des deux côtés)")
    st, b = req("GET", f"/search?q={pA.upper()}&limit=50", tokA)
    s.check("préfixe tapé en MAJUSCULES → mêmes résultats", labels(b), ORDER)

    st, b = req("GET", f"/search?q=%C4%B0{tok}", tokA)  # 'İ' + token, encodé URL
    s.check(
        "'İ' (I turc) trouve la team 'İ…pek' — lower() JS et lower() SQL divergent "
        "sur ce caractère, d'où la mise en minuscules côté base",
        labels(b),
        ["İ" + tok + "pek"],
    )

    # ---------------------------------------------------------- échappement SQL
    s.section("Jokers SQL traités comme du texte")
    st, b = req("GET", f"/search?q={tok}%5F", tokA)  # '_' encodé
    s.check("'_' est littéral, il n'attrape pas le voisin", labels(b), [tok + "_x"])
    st, b = req("GET", f"/search?q={tok}%25", tokA)  # '%' encodé
    s.check("'%' est littéral → aucun résultat", b["results"], [])
    # Le backslash est le caractère d'ÉCHAPPEMENT de LIKE : mal traité, il ferait soit
    # disparaître le caractère suivant, soit planter la requête. `escapeLike` le double.
    st, b = req("GET", f"/search?q={tok}%5C", tokA)  # '\' encodé
    s.check("200 sur un '\\' (pas d'erreur SQL)", st, 200)
    s.check("'\\' est littéral, il ne matche que la team qui en porte un", labels(b), [tok + "\\x"])
    st, b = req("GET", f"/search?q={tok}%5C%25", tokA)  # '\%' encodé : les deux à la fois
    s.check("'\\%' reste littéral → aucun résultat", b["results"], [])
    st, b = req("GET", "/search?q=%25%25", tokA)
    s.check("'%%' seul ne renvoie PAS toute la base", b["results"], [])

    # ---------------------------------------------------------------- blocages
    s.section("Blocages exclus dans les deux sens")
    st, b = req("GET", f"/search?q={pB}", tokA)
    s.check("avant blocage, alice voit bob", labels(b), [pB])
    req("POST", f"/blocks/{idB}", tokA)
    st, b = req("GET", f"/search?q={pB}", tokA)
    s.check("alice a bloqué bob → bob disparaît de SA recherche", b["results"], [])
    st, b = req("GET", f"/search?q={pA}&type=user", tokB)
    s.check("…et alice disparaît de celle de bob (sens inverse)", b["results"], [])
    st, b = req("GET", f"/search?q={pA}&type=team", tokB)
    s.check("les teams, elles, restent visibles", labels(b), [pA, pA + "Mid", pA + "Zeta"])
    req("DELETE", f"/blocks/{idB}", tokA)
    st, b = req("GET", f"/search?q={pB}", tokA)
    s.check("déblocage → bob réapparaît", labels(b), [pB])

    # ------------------------------------------------------------ projection
    s.section("Aucune fuite de champ privé")
    st, b = req("GET", f"/search?q={pA}&type=user", tokA)
    user = b["results"][0]
    s.check("clés exposées", sorted(user.keys()), ["avatarUrl", "displayName", "id", "pseudo", "type"])
    st, b = req("GET", f"/search?q={pA}&type=team", tokA)
    team = b["results"][0]
    s.check("clés exposées (team)", sorted(team.keys()), ["id", "ladderId", "logoUrl", "name", "type"])
    s.check("la team porte bien son ladderId", bool(team["ladderId"]), True)

    # ---------------------------------------------------------------- zéro match
    s.section("Aucun résultat")
    st, b = req("GET", f"/search?q=zz{uuid.uuid4().hex}", tokA)
    s.check("préfixe inconnu → 200", st, 200)
    s.check("…avec une liste vide (pas un 404)", b["results"], [])
    s.check("…et hasMore=false", b.get("hasMore"), False)

    return s.report()
