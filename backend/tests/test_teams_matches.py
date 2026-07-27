"""B15 — GET /teams/:id/matches : historique de match d'une équipe.

Route 100 % lecture. Deux formes de réponse selon le rôle de l'appelant
(`isMember` à la racine) :

  - MEMBRE : voit TOUT, y compris un slot ouvert sans adversaire (`opponent: null`),
    et reçoit la composition nominative (`lineup`) des deux camps.
  - NON-MEMBRE : ne voit que les matchs à 2 sides (un adversaire a déjà accepté) —
    un slot ouvert reste invisible, comme `GET /matches?ladderId=` l'anonymise déjà.
    `lineup` est ABSENT de la réponse.

Couvre aussi :
  - `disputeId`/`disputeStatus` exposés SANS condition de statut de match : le badge
    « litige » doit survivre à l'arbitrage admin (le match repasse `completed`, la
    dispute reste `resolved`) ;
  - `score` qui reste `null` sur les DEUX camps après un arbitrage admin (il tranche
    un vainqueur, pas un score — B14) ;
  - tri par `scheduledAt` décroissant avec `NULLS LAST` (état forcé en SQL : Zod
    l'impose à la création, donc inatteignable par l'API) ;
  - la garde relâchée de `GET /matches/:id` : 403 pour un tiers sur un match NON
    terminé, 200 sur un match `completed` ;
  - `GET /ladders/:id/rankings` : `competitor.id` exploitable sur les deux types
    (`user` et `team`).
"""

import uuid

from helpers import Suite, future, ladder_id, link, register, req, sql


def create_team(tok_cap, ladder, tag):
    st, b = req("POST", "/teams", tok_cap, {"ladderId": ladder, "name": tag + uuid.uuid4().hex[:6]})
    team = b.get("team") or b
    return st, team.get("id"), team.get("name")


def open_team_slot(tok_cap, ladder, lineup, hours):
    _, b = req("POST", "/matches", tok_cap, {"ladderId": ladder, "scheduledAt": future(hours), "lineup": lineup})
    return b["match"]["id"]


def accept_team(tok_cap, m, lineup):
    return req("POST", f"/matches/{m}/accept", tok_cap, {"lineup": lineup})


def open_solo_slot(tok, ladder, hours=1):
    _, b = req("POST", "/matches", tok, {"ladderId": ladder, "scheduledAt": future(hours)})
    return b["match"]["id"]


def backdate(m):
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{m}';")


def side_ids(m):
    s0 = sql(f"select id from match_sides where match_id='{m}' and side_index=0;")
    s1 = sql(f"select id from match_sides where match_id='{m}' and side_index=1;")
    return s0, s1


def run():
    s = Suite("B15 — GET /teams/:id/matches (historique)")

    tokA, idA, pA = register("alice")  # capitaine team A
    tokB, idB, pB = register("bob")  # team A, DANS la lineup
    tokC, idC, pC = register("carol")  # team A, SUR LE BANC
    tokD, idD, pD = register("dave")  # capitaine team B
    tokD2, idD2, pD2 = register("dave")  # 2e joueur de team B (lineup)
    tokADM, idADM, _ = register("erin")  # admin PUR, hors des deux équipes

    VAL2 = ladder_id(tokA, "val", "2v2")  # lockoutMinutes = 30
    CHESS = ladder_id(tokA, "chess", "1v1")
    for t in (tokA, tokB, tokC, tokD, tokD2):
        link(t, "riot")
    for t in (tokA, tokB):
        link(t, "chess_com")
    sql(f"update users set is_admin=true where id='{idADM}';")

    st, TEAM_A, NAME_A = create_team(tokA, VAL2, "TA")
    s.check("team A créée -> 201", st, 201)
    req("POST", f"/teams/{TEAM_A}/members", tokA, {"userId": idB})
    req("POST", f"/teams/{TEAM_A}/members", tokA, {"userId": idC})
    _, TEAM_B, NAME_B = create_team(tokD, VAL2, "TB")
    req("POST", f"/teams/{TEAM_B}/members", tokD, {"userId": idD2})

    # ⚠️ Fenêtres espacées de 2h (>> lockoutMinutes=30 des deux côtés) : sans ça, deux
    # `future()` consécutifs retombent sur le même quart et la 2e création se prend un
    # 409 lockout (§5.2) — reproduit dans test_matches_create.py avec deux appels
    # identiques sur la MÊME team.
    OPEN = open_team_slot(tokA, VAL2, [idA, idB], hours=2)  # jamais accepté

    INPROG = open_team_slot(tokA, VAL2, [idA, idB], hours=4)
    st, b = accept_team(tokD, INPROG, [idD, idD2])
    s.check("team B accepte INPROG -> 200", st, 200, b.get("error", ""))

    DONE = open_team_slot(tokA, VAL2, [idA, idB], hours=6)
    accept_team(tokD, DONE, [idD, idD2])
    backdate(DONE)
    d0, d1 = side_ids(DONE)
    req("POST", f"/matches/{DONE}/result", tokA, {"winnerSideId": d0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{DONE}/result", tokD, {"winnerSideId": d0, "scoreSelf": 0, "scoreOpponent": 2})
    s.check("DONE est bien completed", sql(f"select status from matches where id='{DONE}';"), "completed")

    # Désaccord -> disputed -> arbitrage admin -> completed, dispute `resolved`.
    DISP = open_team_slot(tokA, VAL2, [idA, idB], hours=8)
    accept_team(tokD, DISP, [idD, idD2])
    backdate(DISP)
    e0, e1 = side_ids(DISP)
    req("POST", f"/matches/{DISP}/result", tokA, {"winnerSideId": e0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{DISP}/result", tokD, {"winnerSideId": e1, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("DISP est bien disputed", sql(f"select status from matches where id='{DISP}';"), "disputed")
    DISPUTE_ID = sql(f"select id from disputes where match_id='{DISP}';")
    st, b = req("POST", f"/disputes/{DISPUTE_ID}/resolve", tokADM, {"resolution": "side_0_wins"})
    s.check("admin arbitre DISP (side_0_wins = team A) -> 200", st, 200, b.get("error", ""))
    s.check("DISP repasse completed après arbitrage", sql(f"select status from matches where id='{DISP}';"), "completed")
    # État inatteignable par l'API (Zod impose scheduledAt à la création) : forcé en SQL
    # pour prouver le NULLS LAST, en réutilisant DISP (déjà mis de côté du tri naturel).
    sql(f"update matches set scheduled_at = NULL where id='{DISP}';")

    # ── Membre (alice) : voit tout, avec lineup ─────────────────────────────
    s.section("Membre (alice) — voit tout, y compris le slot ouvert, avec lineup")
    st, b = req("GET", f"/teams/{TEAM_A}/matches", tokA)
    s.check("200", st, 200, b if st != 200 else "")
    s.check("isMember=true", b.get("isMember"), True)
    by_id = {m["id"]: m for m in b.get("matches", [])}

    s.check("le slot ouvert (OPEN) est visible pour un membre", OPEN in by_id, True)
    if OPEN in by_id:
        s.check("OPEN : opponent = null (personne n'a accepté)", by_id[OPEN]["opponent"], None)
        s.check("OPEN : lineup présent pour un membre", "lineup" in by_id[OPEN], True)
        s.check("OPEN : score inchangé (jamais joué)", by_id[OPEN]["score"], {"self": None, "opponent": None})

    s.check("INPROG visible", INPROG in by_id, True)
    if INPROG in by_id:
        s.check("INPROG : opponent = team B", by_id[INPROG]["opponent"]["id"], TEAM_B)
        s.check(
            "INPROG : lineup.self = alice+bob",
            sorted(p["pseudo"] for p in by_id[INPROG]["lineup"]["self"]),
            sorted([pA, pB]),
        )
        s.check(
            "INPROG : lineup.opponent = dave+dave2",
            sorted(p["pseudo"] for p in by_id[INPROG]["lineup"]["opponent"]),
            sorted([pD, pD2]),
        )

    s.check("DONE visible", DONE in by_id, True)
    if DONE in by_id:
        s.check("DONE : result = win (team A a gagné)", by_id[DONE]["result"], "win")
        s.check("DONE : score.self = 2", by_id[DONE]["score"]["self"], 2)
        s.check("DONE : score.opponent = 0", by_id[DONE]["score"]["opponent"], 0)
        s.check("DONE : eloDelta renseigné", by_id[DONE]["eloDelta"] is not None, True)
        s.check("DONE : disputeId = null (jamais de litige)", by_id[DONE]["disputeId"], None)

    s.check("DISP visible", DISP in by_id, True)
    if DISP in by_id:
        s.check(
            "DISP : disputeId présent MALGRÉ status != 'disputed' (arbitré)",
            by_id[DISP]["disputeId"],
            DISPUTE_ID,
        )
        s.check("DISP : disputeStatus = resolved", by_id[DISP]["disputeStatus"], "resolved")
        s.check(
            "DISP : score reste null des 2 côtés (l'admin tranche un vainqueur, pas un score)",
            by_id[DISP]["score"],
            {"self": None, "opponent": None},
        )
        s.check("DISP : result = win malgré l'arbitrage (winnerSideId posé)", by_id[DISP]["result"], "win")

    ids_order = [m["id"] for m in b.get("matches", [])]
    s.check("NULLS LAST : le match sans scheduledAt (DISP) est en DERNIER", ids_order[-1] if ids_order else None, DISP)

    # ── Perdant (dave, capitaine team B) — vue miroir sur DONE ──────────────
    # Le produit garantit : le perdant voit SON PROPRE score en `self` (pas celui de
    # l'adversaire), un `result` à `loss`, et un Elo qui baisse — jamais l'inverse.
    s.section("Perdant (dave, team B) — vue miroir de DONE")
    st, bB = req("GET", f"/teams/{TEAM_B}/matches", tokD)
    s.check("200", st, 200, bB if st != 200 else "")
    s.check("isMember=true (dave est capitaine de team B)", bB.get("isMember"), True)
    by_idB = {m["id"]: m for m in bB.get("matches", [])}
    s.check("DONE visible côté perdant", DONE in by_idB, True)
    if DONE in by_idB and DONE in by_id:
        s.check("DONE (team B) : result = loss", by_idB[DONE]["result"], "loss")
        # ⚠️ Valeurs EN DUR, pas une comparaison croisée avec la vue du vainqueur :
        # `self`/`opponent` inversés dans le handler laisseraient une relation croisée
        # intacte des deux côtés (test de mutation vérifié) — elle ne prouverait rien.
        # Team B a soumis 0-2 : elle doit voir 0 en `self` et 2 en `opponent`.
        s.check(
            "DONE (team B) : score.self = 0 (son propre score, pas celui du vainqueur)",
            by_idB[DONE]["score"]["self"],
            0,
        )
        s.check(
            "DONE (team B) : score.opponent = 2 (le score de team A, vu du perdant)",
            by_idB[DONE]["score"]["opponent"],
            2,
        )
        # Et la symétrie EN PLUS, une fois les deux vues ancrées sur des valeurs réelles.
        s.check(
            "DONE : les deux vues sont bien le miroir l'une de l'autre",
            (by_idB[DONE]["score"]["self"], by_idB[DONE]["score"]["opponent"]),
            (by_id[DONE]["score"]["opponent"], by_id[DONE]["score"]["self"]),
        )
        s.check("DONE (team B) : eloDelta < 0 (le perdant perd de l'Elo)", by_idB[DONE]["eloDelta"] < 0, True)

    # ── Non-membre (dave2, membre de l'équipe adverse) ──────────────────────
    s.section("Non-membre (dave2, team B) — ni slot ouvert ni lineup")
    st, b = req("GET", f"/teams/{TEAM_A}/matches", tokD2)
    s.check("200", st, 200)
    s.check("isMember=false", b.get("isMember"), False)
    by_id2 = {m["id"]: m for m in b.get("matches", [])}
    s.check("OPEN (1 side) N'EST PAS visible pour un non-membre", OPEN in by_id2, False)
    s.check("INPROG (2 sides) EST visible", INPROG in by_id2, True)
    s.check("DONE (2 sides) EST visible", DONE in by_id2, True)
    if INPROG in by_id2:
        s.check("non-membre : aucune lineup exposée sur INPROG", "lineup" in by_id2[INPROG], False)
    if DONE in by_id2:
        s.check("non-membre : aucune lineup exposée sur DONE", "lineup" in by_id2[DONE], False)
        s.check("non-membre : opponent quand même visible (2 sides)", by_id2[DONE]["opponent"]["id"], TEAM_B)

    # ── GET /matches/:id — garde relâchée UNIQUEMENT sur `completed` ────────
    s.section("GET /matches/:id — 403 sauf sur un match completed")
    tokX, _, _ = register("erin")  # parfait étranger
    st, b = req("GET", f"/matches/{INPROG}", tokX)
    s.check("étranger sur match in_progress -> 403", st, 403, b.get("error", ""))
    st, b = req("GET", f"/matches/{DONE}", tokX)
    s.check("étranger sur match completed -> 200", st, 200, b.get("error", ""))

    # ── Erreurs de la route B15 ──────────────────────────────────────────────
    s.section("Gardes B15")
    st, _ = req("GET", f"/teams/{TEAM_A}/matches", None)
    s.check("anonyme -> 401", st, 401)
    st, _ = req("GET", "/teams/pas-un-uuid/matches", tokA)
    s.check("id malformé -> 400", st, 400)
    st, _ = req("GET", f"/teams/{uuid.uuid4()}/matches", tokA)
    s.check("équipe inconnue -> 404", st, 404)

    # ── GET /ladders/:id/rankings — competitor.id exploitable (les 2 types) ─
    s.section("GET /ladders/:id/rankings — competitor.id")
    st, rk = req("GET", f"/ladders/{VAL2}/rankings", tokA)
    entries = rk.get("rankings", []) if isinstance(rk, dict) else []
    team_entries = [e for e in entries if e.get("competitor", {}).get("type") == "team"]
    s.check("au moins une entrée 'team' dans le classement VAL2", len(team_entries) > 0, True)
    s.check(
        "l'id de team A est bien exploitable dans le classement",
        any(e["competitor"].get("id") == TEAM_A for e in team_entries),
        True,
    )

    M_CHESS = open_solo_slot(tokA, CHESS)
    req("POST", f"/matches/{M_CHESS}/accept", tokB)
    backdate(M_CHESS)
    c0, _ = side_ids(M_CHESS)
    req("POST", f"/matches/{M_CHESS}/result", tokA, {"winnerSideId": c0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{M_CHESS}/result", tokB, {"winnerSideId": c0, "scoreSelf": 0, "scoreOpponent": 2})

    st, rk = req("GET", f"/ladders/{CHESS}/rankings", tokA)
    entries = rk.get("rankings", []) if isinstance(rk, dict) else []
    user_entries = [e for e in entries if e.get("competitor", {}).get("type") == "user"]
    s.check("au moins une entrée 'user' dans le classement chess", len(user_entries) > 0, True)
    s.check(
        "l'id d'alice est bien exploitable dans le classement",
        any(e["competitor"].get("id") == idA for e in user_entries),
        True,
    )

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
