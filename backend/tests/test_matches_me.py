"""B5c — GET /matches/me : les matchs qui me concernent.

Deux sources, et c'est tout l'enjeu :
  A. je suis dans `match_participants`  → mes solos + les matchs où j'étais ALIGNÉ
  B. une de mes teams est sur un side   → y compris quand j'étais sur le BANC

Le cas du remplaçant (dans le roster, pas dans la lineup) n'existe QUE grâce à B :
il n'a aucune ligne dans `match_participants`, il serait invisible sans elle.
Et un match d'équipe où j'ai joué remonte des DEUX sources → le Set le dédoublonne.
"""

import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req


def my_match_ids(token):
    _, b = req("GET", "/matches/me", token)
    return [m["id"] for m in b.get("matches", [])]


def my_match(token, match_id):
    _, b = req("GET", "/matches/me", token)
    return next((m for m in b.get("matches", []) if m["id"] == match_id), None)


def run():
    s = Suite("B5c — GET /matches/me")

    tokA, idA, _ = register("alice")  # capitaine team A + joueur solo
    tokB, idB, _ = register("bob")  # membre team A, DANS la lineup
    tokC, idC, _ = register("carol")  # membre team A, SUR LE BANC
    tokD, idD, _ = register("dave")  # capitaine team B (l'adversaire)
    tokE, idE, _ = register("erin")  # membre team B

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")
    for t in (tokA, tokB, tokC, tokD, tokE):
        link(t, "chess_com")
        link(t, "riot")

    s.section("Aucun match → tableau vide (pas une 404)")
    st, b = req("GET", "/matches/me", tokE)
    s.check("erin n'a aucun match → 200", st, 200)
    s.check("… et la liste est vide", b.get("matches"), [])

    # ─────────────────────────────────────────────── SOLO
    s.section("SOLO — source A (je suis participant)")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M1 = b["match"]["id"]
    s.check("alice ouvre un slot solo → 201", st, 201)

    s.check("alice voit son slot solo", M1 in my_match_ids(tokA), True)
    s.check("bob ne le voit PAS (il n'y est pour rien)", M1 in my_match_ids(tokB), False)

    m = my_match(tokA, M1)
    s.check("le slot est `pending`", m["status"], "pending")
    s.check("startedAt est encore null", m["startedAt"], None)
    s.check("les maps sont visibles (c'est MON match)", "maps" in m, True)

    # ─────────────────────────────────────────────── TEAM
    s.section("TEAM — le remplaçant : source B seule")
    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Mine" + uuid.uuid4().hex[:5]})
    TEAM_A = (b.get("team") or b).get("id")
    s.check("team A créée (alice capitaine) → 201", st, 201)
    join_team(TEAM_A, idB)
    join_team(TEAM_A, idC)

    # lineup = alice + bob → carol reste sur le banc
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    M2 = b["match"]["id"]
    s.check("team A ouvre un slot 2v2 (lineup alice+bob) → 201", st, 201)

    s.check("alice (alignée) voit le match", M2 in my_match_ids(tokA), True)
    s.check("bob (aligné) voit le match", M2 in my_match_ids(tokB), True)
    s.check("carol (SUR LE BANC) voit le match de sa team", M2 in my_match_ids(tokC), True)
    s.check("dave (étranger) ne voit rien", M2 in my_match_ids(tokD), False)

    s.section("Déduplication — alice remonte des DEUX sources")
    s.check("le match n'apparaît qu'UNE fois chez alice", my_match_ids(tokA).count(M2), 1)
    s.check("… et une seule fois chez carol aussi", my_match_ids(tokC).count(M2), 1)

    # ─────────────────────────────────────────────── après l'accept
    s.section("Après l'accept — les deux camps voient le même match")
    st, b = req("POST", "/teams", tokD, {"ladderId": VAL2, "name": "Mine" + uuid.uuid4().hex[:5]})
    TEAM_B = (b.get("team") or b).get("id")
    join_team(TEAM_B, idE)

    st, b = req("POST", f"/matches/{M2}/accept", tokD, {"lineup": [idD, idE]})
    s.check("team B accepte → 200", st, 200, b.get("error", ""))

    s.check("dave (accepteur) voit maintenant le match", M2 in my_match_ids(tokD), True)
    s.check("erin (aligné côté B) le voit aussi", M2 in my_match_ids(tokE), True)

    m = my_match(tokA, M2)
    s.check("côté alice, le match est passé in_progress", m["status"], "in_progress")
    s.check("… et startedAt est renseigné", m["startedAt"] is not None, True)

    m = my_match(tokC, M2)
    s.check("le remplaçant voit lui aussi le match démarré", m["status"], "in_progress")

    s.section("Le slot solo est toujours là (tous ladders confondus)")
    ids = my_match_ids(tokA)
    s.check("alice voit ses DEUX matchs (chess + val)", sorted([M1, M2]) == sorted(ids), True)

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()