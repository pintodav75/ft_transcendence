"""B6 — POST /matches/:id/result : soumission de score, accord/désaccord, ELO, jobs 24h.

Le nœud du test : la route exige `now() >= scheduled_at` (§5.3) pour soumettre, alors que
créer/accepter exige une heure DANS LE FUTUR. On lève la contradiction en backdatant
`scheduled_at` en SQL (comme les autres suites forcent des états inatteignables par l'API).
On teste ainsi le VRAI code avec les VRAIES valeurs (15 min, 24 h), sans les toucher.

Couvre :
  - les gardes (401 / 400 body / 404 / 403 non-participant / 400 garde-#3 / 400 §5.3) ;
  - la machine à états : 1re soumission -> awaiting_confirmation ;
  - accord (même vainqueur) -> completed + winner_side_id + completed_at + ELO (K=32) ;
  - désaccord (vainqueurs différents) -> disputed + ligne dans `disputes` ;
  - 409 sur un match déjà terminé ;
  - (opt-in B6_JOBS=1, +65 s) les 2 jobs 24 h : fantôme -> cancelled, auto-confirm -> completed.

ELO attendu : deux joueurs à 1000 -> le gagnant monte à 1016, le perdant tombe à 984
(updateElo(1000, 1000) avec K=32).
"""

import os
import time
import uuid

from helpers import Suite, future, ladder_id, link, register, req, sql


def status_of(m):
    return sql(f"select status from matches where id='{m}';")


def side_id(m, idx):
    return sql(f"select id from match_sides where match_id='{m}' and side_index={idx};")


def rank(user_id, ladder, col):
    return sql(f"select {col} from rankings where user_id='{user_id}' and ladder_id='{ladder}';")


def backdate_sched(m, interval="1 hour"):
    """Recule scheduled_at dans le passé -> la partie est réputée avoir commencé (§5.3)."""
    sql(f"update matches set scheduled_at = now() - interval '{interval}' where id='{m}';")


def start_match(tok_creator, tok_acceptor, ladder):
    """Crée un slot 1v1 (heure future valide) et le fait accepter -> in_progress."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": future()})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    return m


def run():
    s = Suite("B6 — POST /matches/:id/result")

    tokA, idA, _ = register("alice")  # créateur / gagnant
    tokB, idB, _ = register("bob")  # accepteur / perdant
    tokC, idC, _ = register("carol")  # non-participant, puis créateur du match des jobs
    tokD, idD, _ = register("dave")  # accepteur du match des jobs
    CHESS = ladder_id(tokA, "chess", "1v1")
    for t in (tokA, tokB, tokC, tokD):
        link(t, "chess_com")
        link(t, "riot")  # requis par la section 2v2 (ladder val)

    # ─────────────────────────────────────────────── Gardes
    s.section("Gardes")
    M = start_match(tokA, tokB, CHESS)  # in_progress, scheduled_at encore DANS LE FUTUR
    s0 = side_id(M, 0)
    s1 = side_id(M, 1)

    # §5.3 : tant que l'heure n'est pas passée, on ne peut pas soumettre (winnerSideId VALIDE
    # pour dépasser la garde-#3 et atteindre le check temporel).
    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0})
    s.check("§5.3 — soumettre avant l'heure -> 400", (st, b.get("error")), (400, "match not started yet"))

    st, _ = req("POST", f"/matches/{M}/result", None, {"winnerSideId": s0})
    s.check("sans token -> 401", st, 401)

    st, _ = req("POST", f"/matches/{M}/result", tokA, {})
    s.check("body sans winnerSideId -> 400", st, 400)

    st, _ = req("POST", f"/matches/{uuid.uuid4()}/result", tokA, {"winnerSideId": s0})
    s.check("match inconnu -> 404", st, 404)

    backdate_sched(M)  # à partir d'ici, le match est réputé commencé

    st, b = req("POST", f"/matches/{M}/result", tokC, {"winnerSideId": s0})
    s.check("non-participant (carol) -> 403", st, 403, b.get("error", ""))

    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": str(uuid.uuid4())})
    s.check(
        "garde-#3 — winnerSideId pas un side -> 400",
        (st, b.get("error")),
        (400, "winnerSideId is not a side of this match"),
    )

    # ─────────────────────────────────────────────── Machine à états : accord
    s.section("Accord -> completed + ELO")

    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0})
    s.check("1re soumission (alice, s0) -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    s.check("statut = awaiting_confirmation", status_of(M), "awaiting_confirmation")

    st, b = req("POST", f"/matches/{M}/result", tokB, {"winnerSideId": s0})
    s.check("2e soumission MÊME vainqueur (bob, s0) -> 200 completed", (st, b.get("status")), (200, "completed"))
    s.check("statut = completed", status_of(M), "completed")
    s.check("winner_side_id = s0", sql(f"select winner_side_id from matches where id='{M}';"), s0)
    s.check("completed_at posé", sql(f"select completed_at is not null from matches where id='{M}';"), "t")

    s.check("ELO alice (gagnant) = 1016", rank(idA, CHESS, "elo"), "1016")
    s.check("wins alice = 1", rank(idA, CHESS, "wins"), "1")
    s.check("ELO bob (perdant) = 984", rank(idB, CHESS, "elo"), "984")
    s.check("losses bob = 1", rank(idB, CHESS, "losses"), "1")

    # ─────────────────────────────────────────────── GET /ladders/:id/rankings (via l'API)
    s.section("GET /ladders/:id/rankings — le classement se remplit (via l'API, pas SQL)")
    st, rk = req("GET", f"/ladders/{CHESS}/rankings", tokA)
    rankings = rk.get("rankings", []) if isinstance(rk, dict) else []
    s.check("rankings accessible -> 200", st, 200)
    s.check("le classement chess n'est plus vide", len(rankings) > 0, True)
    s.check(
        "une entrée à 1016 / 1 victoire (le gagnant) est classée",
        any(e.get("elo") == 1016 and e.get("wins") == 1 for e in rankings),
        True,
    )

    # ─────────────────────────────────────────────── 409 : match déjà terminé
    s.section("Match déjà terminé")
    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0})
    s.check("soumettre sur un match completed -> 409", st, 409, b.get("error", ""))

    # ─────────────────────────────────────────────── Désaccord
    s.section("Désaccord -> disputed")
    M2 = start_match(tokA, tokB, CHESS)  # alice/bob libérés (M completed)
    backdate_sched(M2)
    d0 = side_id(M2, 0)
    d1 = side_id(M2, 1)

    st, b = req("POST", f"/matches/{M2}/result", tokA, {"winnerSideId": d0})
    s.check("alice soumet d0 -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, b = req("POST", f"/matches/{M2}/result", tokB, {"winnerSideId": d1})
    s.check("bob soumet d1 (différent) -> 200 disputed", (st, b.get("status")), (200, "disputed"))
    s.check("statut = disputed", status_of(M2), "disputed")
    s.check("une dispute ouverte", sql(f"select count(*) from disputes where match_id='{M2}';"), "1")

    # ─────────────────────────────────────────────── 2v2+ : capitaine only + ELO sur la TEAM
    s.section("2v2+ -> soumission réservée au capitaine, ELO sur la TEAM (XOR)")
    VAL2 = ladder_id(tokA, "val", "2v2")
    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "R" + uuid.uuid4().hex[:6]})
    T1 = (b.get("team") or b)["id"]
    req("POST", f"/teams/{T1}/members", tokA, {"userId": idB})
    st, b = req("POST", "/teams", tokC, {"ladderId": VAL2, "name": "K" + uuid.uuid4().hex[:6]})
    T2 = (b.get("team") or b)["id"]
    req("POST", f"/teams/{T2}/members", tokC, {"userId": idD})

    st, b = req(
        "POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]}
    )
    MT = b["match"]["id"]
    req("POST", f"/matches/{MT}/accept", tokC, {"lineup": [idC, idD]})
    backdate_sched(MT)
    mt0 = side_id(MT, 0)  # side de la team 1 (créatrice)

    st, b = req("POST", f"/matches/{MT}/result", tokB, {"winnerSideId": mt0})
    s.check("2v2 — un NON-capitaine (bob) soumet -> 403", st, 403, b.get("error", ""))
    st, b = req("POST", f"/matches/{MT}/result", tokA, {"winnerSideId": mt0})
    s.check("2v2 — le capitaine A soumet -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, b = req("POST", f"/matches/{MT}/result", tokC, {"winnerSideId": mt0})
    s.check("2v2 — le capitaine C confirme -> 200 completed", (st, b.get("status")), (200, "completed"))
    s.check("2v2 — ELO de la TEAM gagnante = 1016", sql(f"select elo from rankings where team_id='{T1}' and ladder_id='{VAL2}';"), "1016")
    s.check("2v2 — ELO de la TEAM perdante = 984", sql(f"select elo from rankings where team_id='{T2}' and ladder_id='{VAL2}';"), "984")
    s.check("2v2 — le JOUEUR n'est PAS classé (c'est la team, XOR)", sql(f"select count(*) from rankings where user_id='{idA}' and ladder_id='{VAL2}';"), "0")

    # ─────────────────────────────────────────────── API-only : le front construit tout via l'API
    s.section("API-only — GET /matches/:id expose side id + état de soumission (fix review #1)")
    Mapi = start_match(tokA, tokB, CHESS)
    backdate_sched(Mapi)
    st, detail = req("GET", f"/matches/{Mapi}", tokA)
    s.check("détail -> 200", st, 200)
    api_sides = detail.get("sides", [])
    s.check("chaque side expose un id", all("id" in sd for sd in api_sides), True)
    s.check("submittedAt exposé et null avant soumission", all(sd.get("submittedAt") is None for sd in api_sides), True)
    api0 = api_sides[0]["id"]  # winnerSideId construit SANS SQL, juste depuis l'API
    st, b = req("POST", f"/matches/{Mapi}/result", tokA, {"winnerSideId": api0})
    s.check("soumission avec le side id venu de l'API -> 200", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, detail2 = req("GET", f"/matches/{Mapi}", tokA)
    side0 = next(sd for sd in detail2["sides"] if sd["id"] == api0)
    s.check("après soumission, submittedAt renseigné (API)", side0.get("submittedAt") is not None, True)
    s.check("après soumission, submittedWinnerSideId = side déclaré (API)", side0.get("submittedWinnerSideId"), api0)
    sql(f"update matches set status='cancelled' where id='{Mapi}';")  # libère A/B, aucun ELO

    # ─────────────────────────────────────────────── Re-soumission = écrasement (fix review #2, route)
    s.section("Re-soumission — un camp corrige son verdict, et c'est le NOUVEAU qui compte")
    Mre = start_match(tokA, tokB, CHESS)
    backdate_sched(Mre)
    re0 = side_id(Mre, 0)  # side d'alice
    re1 = side_id(Mre, 1)  # side de bob
    req("POST", f"/matches/{Mre}/result", tokA, {"winnerSideId": re0})  # alice: « je gagne »
    st, b = req("POST", f"/matches/{Mre}/result", tokA, {"winnerSideId": re1})  # alice se corrige: « bob gagne »
    s.check("re-soumission acceptée (toujours awaiting)", (st, b.get("status")), (200, "awaiting_confirmation"))
    s.check("la déclaration d'alice a été ÉCRASÉE en re1", sql(f"select submitted_winner_side_id from match_sides where id='{re0}';"), re1)
    st, b = req("POST", f"/matches/{Mre}/result", tokB, {"winnerSideId": re1})  # bob confirme re1
    s.check("bob confirme re1 -> completed", (st, b.get("status")), (200, "completed"))
    s.check("le vainqueur final est re1 (la re-soumission a compté)", sql(f"select winner_side_id from matches where id='{Mre}';"), re1)

    # ─────────────────────────────────────────────── Jobs 24 h (opt-in : +65 s)
    if os.environ.get("B6_JOBS"):
        s.section("Jobs 24h (⏳ attend un tick du planificateur ~65s)")
        sql(f"update matches set status='completed' where id='{M2}';")  # libère alice/bob

        # Job A — fantôme : in_progress, aucune soumission, scheduled_at il y a +24 h
        MG = start_match(tokA, tokB, CHESS)
        sql(f"update matches set scheduled_at = now() - interval '25 hours' where id='{MG}';")
        alice_wins_before = rank(idA, CHESS, "wins")  # un fantôme ne doit PAS toucher l'ELO

        # Job B — auto-confirmation : une seule soumission, datant de +24 h
        MS = start_match(tokC, tokD, CHESS)
        backdate_sched(MS)
        c0 = side_id(MS, 0)
        req("POST", f"/matches/{MS}/result", tokC, {"winnerSideId": c0})  # -> awaiting
        sql(
            "update match_sides set submitted_at = now() - interval '25 hours' "
            f"where match_id='{MS}' and submitted_at is not null;"
        )

        # Course route↔jobA : un fantôme QUI A REÇU une soumission (donc passé
        # awaiting_confirmation) ne doit PAS être annulé par le job A pendant le tick — la
        # soumission « sauve » le match (ordonnancement bénin de la course de la re-review).
        tokE, _, _ = register("erin")
        tokF, _, _ = register("alice")  # 2e « alice » : nettoyée par le même motif
        link(tokE, "chess_com")
        link(tokF, "chess_com")
        MR = start_match(tokE, tokF, CHESS)
        sql(f"update matches set scheduled_at = now() - interval '25 hours' where id='{MR}';")
        rr0 = side_id(MR, 0)
        req("POST", f"/matches/{MR}/result", tokE, {"winnerSideId": rr0})  # -> awaiting (submitted_at récent)

        print("   ⏳ attente d'un tick du planificateur (65s)...")
        time.sleep(65)

        s.check("Job A — match fantôme annulé", status_of(MG), "cancelled")
        s.check("Job A — ELO inchangé (un fantôme ne joue pas)", rank(idA, CHESS, "wins"), alice_wins_before)
        s.check("Job B — match auto-confirmé", status_of(MS), "completed")
        s.check("Job B — winner_side_id posé", sql(f"select winner_side_id from matches where id='{MS}';"), c0)
        s.check("Job B — ELO appliqué (carol gagnante = 1016)", rank(idC, CHESS, "elo"), "1016")
        s.check(
            "Course route↔jobA — un fantôme AVEC soumission n'est PAS annulé (reste awaiting)",
            status_of(MR),
            "awaiting_confirmation",
        )
    else:
        s.section("Jobs 24h — SKIP (mettre B6_JOBS=1 pour les tester, +65s)")

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
