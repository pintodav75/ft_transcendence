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

from helpers import Suite, future, join_team, ladder_id, link, register, req, sql

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
    join_team(TEAM_A, idB)
    join_team(TEAM_A, idC)  # carol → banc

    st, b = req("POST", "/teams", tokD, {"ladderId": VAL2, "name": "Karmine" + uuid.uuid4().hex[:4]})
    TEAM_B = (b.get("team") or b).get("id")
    NAME_B = (b.get("team") or b).get("name")
    join_team(TEAM_B, idE)

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

    # ─────────────────────────────────────────────── B16 — ladder + scores soumis
    # Ce que la page match (FT-4) ne peut PAS deviner autrement : le nom du ladder et de
    # son jeu (pour se titrer et décider d'afficher la section maps) et les deux scores
    # soumis par chaque camp (confirmer = renvoyer le miroir exact de la soumission adverse).
    s.section("B16 — le ladder ET son jeu voyagent avec le match")
    st, b = req("GET", f"/matches/{M}", tokA)
    match, sides = b["match"], b["sides"]
    ladder = match.get("ladder") or {}
    s.check("`ladderId` est TOUJOURS là (aucun appelant existant cassé)", match["ladderId"], VAL2)
    s.check("`ladder.id` désigne le même ladder", ladder.get("id"), VAL2)
    s.check("`ladder.format`", ladder.get("format"), "2v2")
    s.check("`ladder.gameId`", ladder.get("gameId"), "val")
    # Noms lus EN BASE : les ladders sont des données de référence posées par les migrations,
    # les recopier ici ferait passer le test au vert sur une valeur inventée.
    ladder_name, game_name = sql(
        f"select l.name || '§' || g.name from ladders l "
        f"join games g on g.id = l.game_id where l.id = '{VAL2}';"
    ).split("§")
    s.check("`ladder.name` = le nom du ladder en base", ladder.get("name"), ladder_name)
    s.check("`ladder.gameName` = le nom du JEU en base", ladder.get("gameName"), game_name)

    s.section("B16 — les deux scores soumis, par side")
    s.check(
        "in_progress : side 0 n'a rien soumis",
        [sides[0].get("submittedScoreSelf"), sides[0].get("submittedScoreOpponent")],
        [None, None],
    )
    s.check(
        "in_progress : side 1 n'a rien soumis",
        [sides[1].get("submittedScoreSelf"), sides[1].get("submittedScoreOpponent")],
        [None, None],
    )
    # §5.3 : on ne soumet pas avant le coup d'envoi → on recule `scheduled_at` en SQL,
    # comme `test_matches_result.py` (l'API ne sait pas créer un match dans le passé).
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{M}';")
    st, b = req(
        "POST", f"/matches/{M}/result", tokA,
        {"winnerSideId": sides[0]["id"], "scoreSelf": 2, "scoreOpponent": 1},
    )
    s.check("alice (side 0) soumet 2-1 → 200", st, 200, b.get("error", ""))
    st, b = req("GET", f"/matches/{M}", tokA)
    sides = b["sides"]
    s.check("le match attend la confirmation", b["match"]["status"], "awaiting_confirmation")
    s.check("side 0 : `submittedScoreSelf` = 2", sides[0].get("submittedScoreSelf"), 2)
    s.check("side 0 : `submittedScoreOpponent` = 1", sides[0].get("submittedScoreOpponent"), 1)
    s.check(
        "side 1 (silencieux) : les deux scores restent null",
        [sides[1].get("submittedScoreSelf"), sides[1].get("submittedScoreOpponent")],
        [None, None],
    )

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