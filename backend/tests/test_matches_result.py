"""B6/B14 — POST /matches/:id/result : score Bo3, accord/désaccord, ELO persisté, jobs 24h.

Le nœud du test : la route exige `now() >= scheduled_at` (§5.3) pour soumettre, alors que
créer/accepter exige une heure DANS LE FUTUR. On lève la contradiction en backdatant
`scheduled_at` en SQL (comme les autres suites forcent des états inatteignables par l'API).
On teste ainsi le VRAI code avec les VRAIES valeurs (15 min, 24 h), sans les toucher.

Depuis B14, tous les matchs sont en **best-of-3** : le body porte `scoreSelf`/`scoreOpponent`
(relatifs au SOUMETTEUR — « moi / lui »), et le score final + le delta d'Elo sont persistés
sur `match_sides` (`score`, `eloDelta`, `eloAfter`).

Couvre :
  - les gardes (401 / 400 body / 404 / 403 non-participant / 400 garde-#3 / 400 §5.3) ;
  - B14 : score hors Bo3 (ni 2-0/2-1/0-2/1-2) -> 400 ; score incohérent avec winnerSideId -> 400 ;
  - la machine à états : 1re soumission -> awaiting_confirmation ;
  - accord (même vainqueur ET score croisé cohérent) -> completed + winner_side_id +
    completed_at + ELO (K=32) + `score`/`eloDelta`/`eloAfter` écrits sur les DEUX sides ;
  - B14 : même vainqueur mais score DIFFÉRENT (2-0 vs 2-1) -> disputed (nouveau comportement) ;
  - désaccord (vainqueurs différents) -> disputed + ligne dans `disputes` ;
  - 409 sur un match déjà terminé ;
  - re-soumission : c'est le DERNIER score qui fait foi, y compris sur ce qui est persisté ;
  - (opt-in B6_JOBS=1, +65 s) les 2 jobs 24 h : fantôme -> cancelled, auto-confirm -> completed
    (avec le score du SEUL camp qui a soumis, correctement remappé).

ELO attendu : deux joueurs à 1000 -> le gagnant monte à 1016, le perdant tombe à 984
(updateElo(1000, 1000) avec K=32).
"""

import os
import time
import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req, sql


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
    # et score Bo3 cohérent, pour dépasser les gardes-#3/score et atteindre le check temporel :
    # ces gardes sont évaluées AVANT le check §5.3, donc un body invalide masquerait le 400 visé).
    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("§5.3 — soumettre avant l'heure -> 400", (st, b.get("error")), (400, "match not started yet"))

    st, _ = req("POST", f"/matches/{M}/result", None, {"winnerSideId": s0})
    s.check("sans token -> 401", st, 401)

    st, _ = req("POST", f"/matches/{M}/result", tokA, {})
    s.check("body sans winnerSideId/scores -> 400", st, 400)

    st, _ = req("POST", f"/matches/{uuid.uuid4()}/result", tokA, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("match inconnu -> 404", st, 404)

    backdate_sched(M)  # à partir d'ici, le match est réputé commencé

    st, b = req("POST", f"/matches/{M}/result", tokC, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("non-participant (carol) -> 403", st, 403, b.get("error", ""))

    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": str(uuid.uuid4()), "scoreSelf": 2, "scoreOpponent": 0})
    s.check(
        "garde-#3 — winnerSideId pas un side -> 400",
        (st, b.get("error")),
        (400, "winnerSideId is not a side of this match"),
    )

    # ─────────────────────────────────────────────── B14 — validation du score Bo3
    s.section("B14 — score Bo3 (0..2, exactement un camp à 2)")
    for bad_self, bad_opp, label in [
        (3, 1, "3-1 (hors bornes)"),
        (1, 0, "1-0 (série inachevée, personne à 2)"),
        (2, 2, "2-2 (deux vainqueurs)"),
        (0, 0, "0-0 (aucun vainqueur)"),
    ]:
        st, b = req(
            "POST", f"/matches/{M}/result", tokA,
            {"winnerSideId": s0, "scoreSelf": bad_self, "scoreOpponent": bad_opp},
        )
        s.check(f"score {label} -> 400", st, 400, b.get("error", ""))

    st, b = req(
        "POST", f"/matches/{M}/result", tokA,
        {"winnerSideId": s1, "scoreSelf": 2, "scoreOpponent": 0},
    )
    s.check(
        "score incohérent avec winnerSideId (je m'attribue 2 mais je désigne l'adversaire vainqueur) -> 400",
        (st, b.get("error")),
        (400, "winnerSideId is inconsistent with the submitted score"),
    )

    # ─────────────────────────────────────────────── Machine à états : accord
    s.section("Accord -> completed + ELO")

    # alice (s0) se déclare vainqueur 2-0 ; bob (s1), en 2e soumission, doit croiser
    # EXACTEMENT ce score (son scoreSelf=0 = le scoreOpponent d'alice, son scoreOpponent=2 =
    # le scoreSelf d'alice) pour que ce soit un ACCORD, pas un litige.
    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("1re soumission (alice, s0, 2-0) -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    s.check("statut = awaiting_confirmation", status_of(M), "awaiting_confirmation")

    st, b = req("POST", f"/matches/{M}/result", tokB, {"winnerSideId": s0, "scoreSelf": 0, "scoreOpponent": 2})
    s.check("2e soumission MÊME vainqueur + score croisé cohérent (bob, s0) -> 200 completed", (st, b.get("status")), (200, "completed"))
    s.check("statut = completed", status_of(M), "completed")
    s.check("winner_side_id = s0", sql(f"select winner_side_id from matches where id='{M}';"), s0)
    s.check("completed_at posé", sql(f"select completed_at is not null from matches where id='{M}';"), "t")

    s.check("ELO alice (gagnant) = 1016", rank(idA, CHESS, "elo"), "1016")
    s.check("wins alice = 1", rank(idA, CHESS, "wins"), "1")
    s.check("ELO bob (perdant) = 984", rank(idB, CHESS, "elo"), "984")
    s.check("losses bob = 1", rank(idB, CHESS, "losses"), "1")

    # B14 — le score final et l'Elo de CE match sont persistés sur `match_sides`, pas juste
    # sur `rankings` (qui, lui, n'a que la valeur courante — le delta d'un match précis y
    # serait perdu dès le match suivant).
    s.check("B14 — score final côté vainqueur (s0) = 2", sql(f"select score from match_sides where id='{s0}';"), "2")
    s.check("B14 — score final côté perdant (s1) = 0", sql(f"select score from match_sides where id='{s1}';"), "0")
    s.check("B14 — eloDelta vainqueur = +16", sql(f"select elo_delta from match_sides where id='{s0}';"), "16")
    s.check("B14 — eloDelta perdant = -16", sql(f"select elo_delta from match_sides where id='{s1}';"), "-16")
    s.check("B14 — eloAfter vainqueur = 1016 (cohérent avec rankings)", sql(f"select elo_after from match_sides where id='{s0}';"), "1016")
    s.check("B14 — eloAfter perdant = 984 (cohérent avec rankings)", sql(f"select elo_after from match_sides where id='{s1}';"), "984")

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
    st, b = req("POST", f"/matches/{M}/result", tokA, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("soumettre sur un match completed -> 409", st, 409, b.get("error", ""))

    # ─────────────────────────────────────────────── Désaccord (vainqueur différent)
    s.section("Désaccord — vainqueur différent -> disputed")
    M2 = start_match(tokA, tokB, CHESS)  # alice/bob libérés (M completed)
    backdate_sched(M2)
    d0 = side_id(M2, 0)
    d1 = side_id(M2, 1)

    st, b = req("POST", f"/matches/{M2}/result", tokA, {"winnerSideId": d0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("alice soumet d0 (2-0) -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, b = req("POST", f"/matches/{M2}/result", tokB, {"winnerSideId": d1, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("bob soumet d1 (vainqueur différent, 2-0) -> 200 disputed", (st, b.get("status")), (200, "disputed"))
    s.check("statut = disputed", status_of(M2), "disputed")
    s.check("une dispute ouverte", sql(f"select count(*) from disputes where match_id='{M2}';"), "1")

    # ─────────────────────────────────────────────── B14 — MÊME vainqueur, score DIFFÉRENT
    s.section("B14 — même vainqueur, score différent (2-0 vs 2-1) -> disputed (nouveau comportement)")
    M2b = start_match(tokA, tokB, CHESS)
    backdate_sched(M2b)
    e0 = side_id(M2b, 0)  # side d'alice
    e1 = side_id(M2b, 1)  # side de bob

    st, b = req("POST", f"/matches/{M2b}/result", tokA, {"winnerSideId": e0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("alice soumet e0 vainqueur, 2-0 -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    # bob est D'ACCORD sur le vainqueur (e0 = alice) mais pas sur le score : de SON point de
    # vue il a pris une manche (1-2), donc scoreOpponent=2 (alice), scoreSelf=1 (lui-même) —
    # ça ne croise PAS le 2-0 déclaré par alice (elle prétend scoreOpponent=0, pas 1).
    st, b = req("POST", f"/matches/{M2b}/result", tokB, {"winnerSideId": e0, "scoreSelf": 1, "scoreOpponent": 2})
    s.check(
        "bob est d'accord sur le vainqueur (e0) mais déclare 1-2 (pas 0-2) -> disputed",
        (st, b.get("status")),
        (200, "disputed"),
    )
    s.check("statut = disputed (même vainqueur, score en désaccord)", status_of(M2b), "disputed")
    s.check("une dispute ouverte pour ce cas", sql(f"select count(*) from disputes where match_id='{M2b}';"), "1")
    s.check("aucun ELO appliqué (le match n'est pas completed)", rank(idA, CHESS, "wins"), "1")  # inchangé depuis M

    # ─────────────────────────────────────────────── 2v2+ : capitaine only + ELO sur la TEAM
    s.section("2v2+ -> soumission réservée au capitaine, ELO sur la TEAM (XOR)")
    VAL2 = ladder_id(tokA, "val", "2v2")
    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "R" + uuid.uuid4().hex[:6]})
    T1 = (b.get("team") or b)["id"]
    join_team(T1, idB)
    st, b = req("POST", "/teams", tokC, {"ladderId": VAL2, "name": "K" + uuid.uuid4().hex[:6]})
    T2 = (b.get("team") or b)["id"]
    join_team(T2, idD)

    st, b = req(
        "POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]}
    )
    MT = b["match"]["id"]
    req("POST", f"/matches/{MT}/accept", tokC, {"lineup": [idC, idD]})
    backdate_sched(MT)
    mt0 = side_id(MT, 0)  # side de la team 1 (créatrice)

    st, b = req("POST", f"/matches/{MT}/result", tokB, {"winnerSideId": mt0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("2v2 — un NON-capitaine (bob) soumet -> 403", st, 403, b.get("error", ""))
    st, b = req("POST", f"/matches/{MT}/result", tokA, {"winnerSideId": mt0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("2v2 — le capitaine A soumet (2-0) -> 200 awaiting", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, b = req("POST", f"/matches/{MT}/result", tokC, {"winnerSideId": mt0, "scoreSelf": 0, "scoreOpponent": 2})
    s.check("2v2 — le capitaine C confirme (score croisé) -> 200 completed", (st, b.get("status")), (200, "completed"))
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
    st, b = req("POST", f"/matches/{Mapi}/result", tokA, {"winnerSideId": api0, "scoreSelf": 2, "scoreOpponent": 0})
    s.check("soumission avec le side id venu de l'API -> 200", (st, b.get("status")), (200, "awaiting_confirmation"))
    st, detail2 = req("GET", f"/matches/{Mapi}", tokA)
    side0 = next(sd for sd in detail2["sides"] if sd["id"] == api0)
    s.check("après soumission, submittedAt renseigné (API)", side0.get("submittedAt") is not None, True)
    s.check("après soumission, submittedWinnerSideId = side déclaré (API)", side0.get("submittedWinnerSideId"), api0)
    sql(f"update matches set status='cancelled' where id='{Mapi}';")  # libère A/B, aucun ELO

    # ─────────────────────────────────────────────── Re-soumission = écrasement (fix review #2, route)
    s.section("Re-soumission — un camp corrige son verdict (ET son score), et c'est le NOUVEAU qui compte")
    Mre = start_match(tokA, tokB, CHESS)
    backdate_sched(Mre)
    re0 = side_id(Mre, 0)  # side d'alice
    re1 = side_id(Mre, 1)  # side de bob
    req("POST", f"/matches/{Mre}/result", tokA, {"winnerSideId": re0, "scoreSelf": 2, "scoreOpponent": 0})  # alice: « je gagne 2-0 »
    # alice se corrige : « bob gagne » — et le score change aussi (1-2, pas 0-2).
    st, b = req("POST", f"/matches/{Mre}/result", tokA, {"winnerSideId": re1, "scoreSelf": 1, "scoreOpponent": 2})
    s.check("re-soumission acceptée (toujours awaiting)", (st, b.get("status")), (200, "awaiting_confirmation"))
    s.check("la déclaration d'alice a été ÉCRASÉE en re1", sql(f"select submitted_winner_side_id from match_sides where id='{re0}';"), re1)
    s.check(
        "B14 — les SCORES soumis ont aussi été écrasés (plus 2-0, désormais 1-2)",
        sql(f"select submitted_score_self||'-'||submitted_score_opponent from match_sides where id='{re0}';"),
        "1-2",
    )
    # bob confirme re1, en croisant le NOUVEAU score d'alice (1-2), pas l'ancien (2-0).
    st, b = req("POST", f"/matches/{Mre}/result", tokB, {"winnerSideId": re1, "scoreSelf": 2, "scoreOpponent": 1})
    s.check("bob confirme re1 (score croisé sur la DERNIÈRE soumission) -> completed", (st, b.get("status")), (200, "completed"))
    s.check("le vainqueur final est re1 (la re-soumission a compté)", sql(f"select winner_side_id from matches where id='{Mre}';"), re1)
    s.check("B14 — score final persisté = le DERNIER soumis (bob=2, pas l'ancien 0)", sql(f"select score from match_sides where id='{re1}';"), "2")
    s.check("B14 — score final persisté côté alice = 1 (le dernier soumis, pas 0)", sql(f"select score from match_sides where id='{re0}';"), "1")

    # ─────────────────────────────────────────────── Jobs 24 h (opt-in : +65 s)
    if os.environ.get("B6_JOBS"):
        s.section("Jobs 24h (⏳ attend un tick du planificateur ~65s)")
        sql(f"update matches set status='completed' where id='{M2}';")  # libère alice/bob

        # Job A — fantôme : in_progress, aucune soumission, scheduled_at il y a +24 h
        MG = start_match(tokA, tokB, CHESS)
        sql(f"update matches set scheduled_at = now() - interval '25 hours' where id='{MG}';")
        alice_wins_before = rank(idA, CHESS, "wins")  # un fantôme ne doit PAS toucher l'ELO

        # Job B — auto-confirmation : une seule soumission (2-0), datant de +24 h
        MS = start_match(tokC, tokD, CHESS)
        backdate_sched(MS)
        c0 = side_id(MS, 0)
        d0 = side_id(MS, 1)
        req("POST", f"/matches/{MS}/result", tokC, {"winnerSideId": c0, "scoreSelf": 2, "scoreOpponent": 0})  # -> awaiting
        sql(
            "update match_sides set submitted_at = now() - interval '25 hours' "
            f"where match_id='{MS}' and submitted_at is not null;"
        )

        # B14 — Job B (bis) : auto-confirmation quand le SEUL soumetteur se déclare
        # PERDANT. `autoConfirmMatches` calcule `submitterWon` (jobs/index.ts) mais le cas
        # `submitterWon === false` n'était couvert par AUCUN test — trou de couverture
        # signalé en review, à l'endroit exact le plus exposé à une inversion silencieuse
        # du remappage « moi/lui » -> « vainqueur/perdant ».
        tokG, idG, _ = register("carol")  # 2e « carol » : nettoyée par le même motif
        tokH, idH, _ = register("dave")  # 2e « dave » : nettoyée par le même motif
        link(tokG, "chess_com")
        link(tokH, "chess_com")
        ML = start_match(tokG, tokH, CHESS)
        backdate_sched(ML)
        g0 = side_id(ML, 0)  # side de carol (le soumetteur)
        h0 = side_id(ML, 1)  # side de dave (silencieux)
        # carol (g0) soumet en se déclarant PERDANTE : winnerSideId = h0 (dave), de son point
        # de vue elle a pris 1 manche (1-2) : scoreSelf=1 (elle-même), scoreOpponent=2 (dave).
        req("POST", f"/matches/{ML}/result", tokG, {"winnerSideId": h0, "scoreSelf": 1, "scoreOpponent": 2})
        sql(
            "update match_sides set submitted_at = now() - interval '25 hours' "
            f"where match_id='{ML}' and submitted_at is not null;"
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
        req("POST", f"/matches/{MR}/result", tokE, {"winnerSideId": rr0, "scoreSelf": 2, "scoreOpponent": 0})  # -> awaiting (submitted_at récent)

        print("   ⏳ attente d'un tick du planificateur (65s)...")
        time.sleep(65)

        s.check("Job A — match fantôme annulé", status_of(MG), "cancelled")
        s.check("Job A — ELO inchangé (un fantôme ne joue pas)", rank(idA, CHESS, "wins"), alice_wins_before)
        s.check("Job B — match auto-confirmé", status_of(MS), "completed")
        s.check("Job B — winner_side_id posé", sql(f"select winner_side_id from matches where id='{MS}';"), c0)
        s.check("Job B — ELO appliqué (carol gagnante = 1016)", rank(idC, CHESS, "elo"), "1016")
        # B14 — le score du camp SILENCIEUX (dave) vient bien de l'unique soumission de carol,
        # correctement remappé (carol a soumis scoreSelf=2/scoreOpponent=0 pour SA victoire).
        s.check("Job B — score persisté côté vainqueur (carol) = 2", sql(f"select score from match_sides where id='{c0}';"), "2")
        s.check("Job B — score persisté côté silencieux (dave) = 0", sql(f"select score from match_sides where id='{d0}';"), "0")

        # B14 — Job B (bis) : le soumetteur (carol/g0) s'est déclarée PERDANTE -> le
        # vainqueur final doit être dave (h0), PAS carol — c'est exactement le remappage
        # que ce test protège contre une inversion silencieuse.
        s.check("Job B bis — match auto-confirmé", status_of(ML), "completed")
        s.check("Job B bis — winner_side_id = dave (h0), pas le soumetteur", sql(f"select winner_side_id from matches where id='{ML}';"), h0)
        s.check("Job B bis — score vainqueur (dave, h0) = 2 (remappé depuis scoreOpponent de carol)", sql(f"select score from match_sides where id='{h0}';"), "2")
        s.check("Job B bis — score perdant (carol, g0) = 1 (remappé depuis scoreSelf de carol)", sql(f"select score from match_sides where id='{g0}';"), "1")
        s.check("Job B bis — ELO vainqueur (dave) = 1016", rank(idH, CHESS, "elo"), "1016")
        s.check("Job B bis — ELO perdant (carol) = 984", rank(idG, CHESS, "elo"), "984")
        s.check("Job B bis — eloDelta vainqueur (dave) = +16", sql(f"select elo_delta from match_sides where id='{h0}';"), "16")
        s.check("Job B bis — eloDelta perdant (carol) = -16", sql(f"select elo_delta from match_sides where id='{g0}';"), "-16")
        s.check("Job B bis — eloAfter vainqueur (dave) = 1016", sql(f"select elo_after from match_sides where id='{h0}';"), "1016")
        s.check("Job B bis — eloAfter perdant (carol) = 984", sql(f"select elo_after from match_sides where id='{g0}';"), "984")
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
