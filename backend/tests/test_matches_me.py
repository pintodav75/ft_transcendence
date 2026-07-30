"""B5c — GET /matches/me : les matchs qui me concernent.

Deux sources, et c'est tout l'enjeu :
  A. je suis dans `match_participants`  → mes solos + les matchs où j'étais ALIGNÉ
  B. une de mes teams est sur un side   → y compris quand j'étais sur le BANC

Le cas du remplaçant (dans le roster, pas dans la lineup) n'existe QUE grâce à B :
il n'a aucune ligne dans `match_participants`, il serait invisible sans elle.
Et un match d'équipe où j'ai joué remonte des DEUX sources → le Set le dédoublonne.

B-SOLO a enrichi la route au gabarit de `GET /teams/{id}/matches` : `opponent` polymorphe,
`score`, `result`, `eloDelta`, `disputeId`/`disputeStatus`, `format`/`gameId`, et un
`?ladderId=` optionnel. Les sections « B-SOLO » ci-dessous couvrent ces ajouts, et surtout
les DEUX cas que le seed ne sait pas produire et qu'aucun curl ne peut atteindre :
  - une équipe adverse **dissoute** après un 2v2 terminé → `opponent: null`, JAMAIS un
    joueur (`match_sides.team_id` est en SET NULL : c'est le FORMAT du ladder qui tranche) ;
  - un adversaire de 1v1 qui **supprime son compte** → `opponent: null` lui aussi.
"""

import uuid

from helpers import FIXTURE_PASSWORD, Suite, future, join_team, ladder_id, link, register, req, sql


# Mêmes trois utilitaires que `test_matches_result.py`, `test_teams_matches.py`,
# `test_notifications.py` et `test_users_deletion.py` : la duplication est le motif établi
# du repo pour ce trio (il n'est pas dans `helpers.py`), les suites restent autonomes.
def side_id(m, idx):
    return sql(f"select id from match_sides where match_id='{m}' and side_index={idx};")


def backdate_sched(m, interval="1 hour"):
    """Recule scheduled_at dans le passé → la partie est réputée avoir commencé (§5.3).
    C'est la SEULE opération de fixture que l'API ne sait pas faire."""
    sql(f"update matches set scheduled_at = now() - interval '{interval}' where id='{m}';")


def start_match(tok_creator, tok_acceptor, ladder):
    """Crée un slot 1v1 (heure future valide) et le fait accepter → in_progress."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": future()})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    return m


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

    # ═══════════════════════════════════════════════════════════ B-SOLO
    s.section("B-SOLO — les champs de contexte servis par la jointure sur `ladders`")
    m = my_match(tokA, M2)
    s.check("le ladder est rappelé", m["ladderId"], VAL2)
    s.check("le jeu vient de la jointure", m["gameId"], "val")
    s.check("le format aussi", m["format"], "2v2")
    s.check("completedAt est null tant que rien n'est clos", m["completedAt"], None)
    s.check("… disputeId également", m["disputeId"], None)
    s.check("… et disputeStatus", m["disputeStatus"], None)

    s.section("B-SOLO — opponent : une ÉQUIPE en 2v2+")
    s.check("alice voit la team d'en face", (my_match(tokA, M2)["opponent"] or {}).get("type"), "team")
    s.check("… et c'est bien team B", (my_match(tokA, M2)["opponent"] or {}).get("id"), TEAM_B)
    s.check("le REMPLAÇANT voit le même adversaire", (my_match(tokC, M2)["opponent"] or {}).get("id"), TEAM_B)
    s.check("vu d'en face, l'adversaire est team A", (my_match(tokD, M2)["opponent"] or {}).get("id"), TEAM_A)

    s.section("B-SOLO — un créneau sans preneur n'a ni adversaire ni chiffres")
    m = my_match(tokA, M1)
    s.check("opponent est null sur un slot pending", m["opponent"], None)
    s.check("… le score est vide des deux côtés", m["score"], {"self": None, "opponent": None})
    s.check("… eloDelta est null", m["eloDelta"], None)
    s.check("… et result aussi", m["result"], None)

    s.section("B-SOLO — le filtre ?ladderId=")
    _, b = req("GET", f"/matches/me?ladderId={CHESS}", tokA)
    s.check("filtrée sur chess, alice ne voit que son solo", [x["id"] for x in b["matches"]], [M1])
    _, b = req("GET", f"/matches/me?ladderId={VAL2}", tokA)
    s.check("filtrée sur val, que le 2v2", [x["id"] for x in b["matches"]], [M2])
    st, _ = req("GET", "/matches/me?ladderId=pas-un-uuid", tokA)
    s.check("un ladderId malformé → 400 (Zod), pas un 500", st, 400)
    st, b = req("GET", f"/matches/me?ladderId={uuid.uuid4()}", tokA)
    s.check("un ladder où je n'ai rien → 200", st, 200)
    s.check("… et la liste est vide, pas une 404", b.get("matches"), [])

    s.section("B-SOLO — un 1v1 mené à son terme : opponent JOUEUR, score, result, elo")
    tokF, _idF, _pF = register("dave")
    tokG, _idG, pseudoG = register("erin")
    link(tokF, "chess_com")
    link(tokG, "chess_com")
    M3 = start_match(tokF, tokG, CHESS)
    backdate_sched(M3)
    f_side = side_id(M3, 0)
    req("POST", f"/matches/{M3}/result", tokF, {"winnerSideId": f_side, "scoreSelf": 2, "scoreOpponent": 1})
    st, b = req("POST", f"/matches/{M3}/result", tokG, {"winnerSideId": f_side, "scoreSelf": 1, "scoreOpponent": 2})
    s.check("les deux camps s'accordent → 200", st, 200, b.get("error", ""))

    m = my_match(tokF, M3)
    s.check("le match est completed", m["status"], "completed")
    s.check("completedAt est renseigné", m["completedAt"] is not None, True)
    s.check("l'adversaire est un JOUEUR", (m["opponent"] or {}).get("type"), "user")
    s.check("… nommément erin", (m["opponent"] or {}).get("pseudo"), pseudoG)
    s.check("le vainqueur lit result=win", m["result"], "win")
    s.check("… avec son score 2-1", m["score"], {"self": 2, "opponent": 1})
    s.check("… et un elo qui monte", m["eloDelta"] is not None and m["eloDelta"] > 0, True)
    m = my_match(tokG, M3)
    s.check("le perdant lit result=loss", m["result"], "loss")
    s.check("… son score est le MIROIR (1-2)", m["score"], {"self": 1, "opponent": 2})
    s.check("… et son elo baisse", m["eloDelta"] < 0, True)

    # 🚨 LA régression que ce ticket devait éviter. `match_sides.team_id` est en SET NULL :
    # une équipe dissoute laisse un camp orphelin sur un match TERMINÉ. Lire ce null comme
    # « joueur solo » renverrait le 1er joueur du camp adverse à la place de l'équipe — le
    # bug introduit puis corrigé côté front pendant FT-4A. Ce cas est INATTEIGNABLE par le
    # seed et par curl : il faut dissoudre une équipe APRÈS un match terminé.
    s.section("B-SOLO — LE PIÈGE : une équipe dissoute n'est pas un joueur solo")
    backdate_sched(M2)
    a_side = side_id(M2, 0)
    req("POST", f"/matches/{M2}/result", tokA, {"winnerSideId": a_side, "scoreSelf": 2, "scoreOpponent": 0})
    st, b = req("POST", f"/matches/{M2}/result", tokD, {"winnerSideId": a_side, "scoreSelf": 0, "scoreOpponent": 2})
    s.check("le 2v2 se clôt → 200", st, 200, b.get("error", ""))
    st, b = req("DELETE", f"/teams/{TEAM_B}", tokD)
    s.check("team B, désormais désengagée, est dissoute → 200", st, 200, b.get("error", ""))

    m = my_match(tokA, M2)
    s.check("le match reste un 2v2", m["format"], "2v2")
    s.check("l'adversaire dissous rend null, JAMAIS un joueur", m["opponent"], None)
    s.check("… mais le score survit", m["score"], {"self": 2, "opponent": 0})
    s.check("… et le delta d'elo aussi", m["eloDelta"] is not None, True)
    s.check("… et le résultat", m["result"], "win")

    # Le cousin du cas précédent, tout aussi normal depuis BX-DEL : partir est AUTORISÉ une
    # fois ses matchs terminés, et `match_participants.user_id` est en CASCADE.
    s.section("B-SOLO — un adversaire qui supprime son compte rend null lui aussi")
    # Le mot de passe est EXIGÉ dans le corps dès que le compte en a un (les users semés par
    # `register()` portent tous FIXTURE_HASH) — sans lui c'est un 400, et le compte survit.
    st, b = req("DELETE", "/users/me", tokG, {"password": FIXTURE_PASSWORD})
    s.check("erin, ses matchs terminés, peut partir → 200", st, 200, b.get("error", ""))
    m = my_match(tokF, M3)
    s.check("le match reste un 1v1", m["format"], "1v1")
    s.check("l'adversaire supprimé rend null", m["opponent"], None)
    s.check("… le score du survivant est intact", m["score"], {"self": 2, "opponent": 1})
    s.check("… et son résultat aussi", m["result"], "win")

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()