"""B5c — GET /matches/:id enrichi : le détail que le front affiche.

Avant, la route crachait des ids bruts (`teamId`, une liste de `userId`) : le front
aurait dû faire N appels de plus pour afficher un nom. Maintenant elle rend le nom
et le logo des teams, le capitaine, et les pseudos/avatars des joueurs — en DEUX
requêtes SQL (pas une par joueur : c'est le piège N+1).

Ce qui doit rester vrai :
  - `team` vaut `null` en solo (les deux sides y ont team_id = NULL)
  - les sides sont TRIÉS (side 0 = le créateur, side 1 = l'accepteur)
  - la garde « participants only » tient toujours, banc compris
  - AUCUN champ privé ne fuit (email, passwordHash, totpSecret…)
"""

import uuid

from helpers import Suite, future, ladder_id, link, register, req

PRIVATE_FIELDS = ("email", "passwordHash", "password_hash", "totpSecret", "totp_secret", "bio")


def run():
    s = Suite("B5c — GET /matches/:id (détail enrichi)")

    tokA, idA, pA = register("alice")  # capitaine team A
    tokB, idB, pB = register("bob")  # membre team A, DANS la lineup
    tokC, idC, pC = register("carol")  # membre team A, SUR LE BANC
    tokD, idD, pD = register("dave")  # capitaine team B
    tokE, idE, pE = register("erin")  # membre team B

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")
    for t in (tokA, tokB, tokC, tokD, tokE):
        link(t, "chess_com")
        link(t, "riot")

    # ─────────────────────────────────────────────── TEAM (val 2v2, accepté)
    s.section("TEAM — les deux camps, avec noms et capitaines")

    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Ratones" + uuid.uuid4().hex[:4]})
    TEAM_A = (b.get("team") or b).get("id")
    NAME_A = (b.get("team") or b).get("name")
    req("POST", f"/teams/{TEAM_A}/members", tokA, {"userId": idB})
    req("POST", f"/teams/{TEAM_A}/members", tokA, {"userId": idC})  # carol → banc

    st, b = req("POST", "/teams", tokD, {"ladderId": VAL2, "name": "Karmine" + uuid.uuid4().hex[:4]})
    TEAM_B = (b.get("team") or b).get("id")
    NAME_B = (b.get("team") or b).get("name")
    req("POST", f"/teams/{TEAM_B}/members", tokD, {"userId": idE})

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    M = b["match"]["id"]
    st, b = req("POST", f"/matches/{M}/accept", tokD, {"lineup": [idD, idE]})
    s.check("team B accepte → 200", st, 200, b.get("error", ""))

    st, b = req("GET", f"/matches/{M}", tokA)
    s.check("le détail est accessible au capitaine → 200", st, 200)

    match, sides = b["match"], b["sides"]
    s.check("le match est in_progress", match["status"], "in_progress")
    s.check("startedAt est renseigné", match["startedAt"] is not None, True)
    s.check("3 maps sont tirées (BO3 Valorant)", len(match["maps"]), 3)

    s.check("il y a exactement 2 sides", len(sides), 2)
    s.check("side 0 en premier (le créateur)", sides[0]["sideIndex"], 0)
    s.check("side 1 en second (l'accepteur)", sides[1]["sideIndex"], 1)

    s.section("TEAM — l'objet team remplace l'id brut")
    s.check("side 0 porte le NOM de la team A", sides[0]["team"]["name"], NAME_A)
    s.check("side 0 porte l'id de la team A", sides[0]["team"]["id"], TEAM_A)
    s.check("side 0 nomme son capitaine (alice)", sides[0]["team"]["captainId"], idA)
    s.check("side 1 porte le NOM de la team B", sides[1]["team"]["name"], NAME_B)
    s.check("side 1 nomme son capitaine (dave)", sides[1]["team"]["captainId"], idD)

    s.section("TEAM — les joueurs ont un pseudo, plus juste un uuid")
    p0 = sorted([p["pseudo"] for p in sides[0]["players"]])
    p1 = sorted([p["pseudo"] for p in sides[1]["players"]])
    s.check("side 0 = la lineup alice+bob", p0, sorted([pA, pB]))
    s.check("side 1 = la lineup dave+erin", p1, sorted([pD, pE]))
    s.check("carol (banc) n'est PAS dans la lineup affichée", pC in p0, False)
    s.check("un joueur porte avatarUrl", "avatarUrl" in sides[0]["players"][0], True)

    s.section("TEAM — aucune fuite de champ privé")
    leaked = [f for p in sides[0]["players"] + sides[1]["players"] for f in PRIVATE_FIELDS if f in p]
    s.check("pas d'email / passwordHash / totpSecret dans les joueurs", leaked, [])

    s.section("TEAM — la garde 403 tient toujours")
    st, b = req("GET", f"/matches/{M}", tokC)
    s.check("carol (banc, membre du roster) VOIT le détail → 200", st, 200, b.get("error", ""))
    tokX, _, _ = register("erin")  # un parfait étranger
    st, b = req("GET", f"/matches/{M}", tokX)
    s.check("un étranger → 403", st, 403, b.get("error", ""))

    # ─────────────────────────────────────────────── SOLO (chess 1v1)
    s.section("SOLO — team vaut null des deux côtés")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M1 = b["match"]["id"]
    st, b = req("POST", f"/matches/{M1}/accept", tokB)
    s.check("bob accepte le slot solo d'alice → 200", st, 200, b.get("error", ""))

    st, b = req("GET", f"/matches/{M1}", tokA)
    sides = b["sides"]
    s.check("side 0 : team est null (solo)", sides[0]["team"], None)
    s.check("side 1 : team est null (solo)", sides[1]["team"], None)
    s.check("side 0 : un seul joueur", len(sides[0]["players"]), 1)
    s.check("side 0 : c'est bien alice", sides[0]["players"][0]["pseudo"], pA)
    s.check("side 1 : c'est bien bob", sides[1]["players"][0]["pseudo"], pB)
    s.check("chess n'a pas de pool de maps → []", b["match"]["maps"], [])

    s.section("Erreurs")
    st, _ = req("GET", f"/matches/{uuid.uuid4()}", tokA)
    s.check("id inexistant → 404", st, 404)
    st, _ = req("GET", "/matches/pas-un-uuid", tokA)
    s.check("id non-uuid → 400", st, 400)

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()