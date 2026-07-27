"""B9 — notifications : les 8 déclencheurs, les 3 routes REST, destinataires 1v1/2v2.

Deux couches : la table `notifications` = la source de vérité (ce que cette suite teste),
le push WebSocket = du best-effort par-dessus (testé à la main, comme la présence chat —
décision de la carte). Ce qui doit rester vrai :
  - on notifie le camp CONCERNÉ, JAMAIS l'acteur (mais ses coéquipiers, si) ;
  - destinataires d'équipe = les joueurs ALIGNÉS (`match_participants`), banc exclu ;
  - une dispute créée notifie AUSSI tous les `is_admin` (dispute_needs_admin) ;
  - GET /notifications : plus récentes d'abord, pagination par curseur, unreadCount global ;
  - PATCH read : mienne only (pas-à-moi -> le MÊME 404 qu'inexistante), idempotente ;
  - payload `data` display-safe : ids/heure, jamais d'email ni de hash.

Jobs 24 h en opt-in (B9_JOBS=1, +65 s) comme B6_JOBS/B7_JOBS : fantôme, auto-confirm et
dispute auto-annulée notifient les DEUX camps (pas d'acteur : c'est le robot qui agit).
"""

import os
import time
import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req, sql

NOTIF_KEYS = {"id", "type", "data", "readAt", "createdAt"}
PRIVATE_FIELDS = ("email", "passwordHash", "password_hash", "totpSecret", "totp_secret", "userId")


def status_of(m):
    return sql(f"select status from matches where id='{m}';")


def side_id(m, idx):
    return sql(f"select id from match_sides where match_id='{m}' and side_index={idx};")


def backdate_sched(m, interval="1 hour"):
    sql(f"update matches set scheduled_at = now() - interval '{interval}' where id='{m}';")


def get_notifs(token, qs=""):
    """Renvoie (status, body) de GET /notifications. body = {notifications, unreadCount, nextCursor}."""
    return req("GET", f"/notifications{qs}", token)


def of_type(body, ntype, match_id=None):
    """Les notifs d'un type (et optionnellement d'un match) dans une réponse GET."""
    out = [n for n in body.get("notifications", []) if n.get("type") == ntype]
    if match_id is not None:
        out = [n for n in out if n.get("data", {}).get("matchId") == match_id]
    return out


def of_match(body, match_id):
    """TOUTES les notifs liées à un match, quel que soit leur type.

    Sert aux assertions « ce joueur ne reçoit RIEN sur ce match » (typiquement le banc).
    ⚠️ Ne PAS compter `notifications` en entier pour ça : une notif d'équipe parfaitement
    légitime (B11 `team_member_removed`, B-INV `team_invitation_*`) ferait tomber le test sur
    quelque chose qui n'a rien à voir avec le match. C'est le faux rouge corrigé le 24/07 ;
    il resterait possible même si `helpers.join_team()` sème désormais les rosters en SQL
    (donc SANS notification) — le filtre par `matchId` reste la bonne défense.
    """
    return [n for n in body.get("notifications", []) if n.get("data", {}).get("matchId") == match_id]


def start_match(tok_creator, tok_acceptor, ladder, at=None):
    """Crée un slot 1v1 et le fait accepter -> in_progress. Renvoie l'id du match."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": at or future()})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    return m


def run():
    s = Suite("B9 — notifications (8 déclencheurs + 3 routes REST)")

    tokA, idA, _ = register("alice")  # créatrice des slots
    tokB, idB, _ = register("bob")  # accepteur (= l'acteur de l'accept)
    tokC, idC, _ = register("carol")  # coéquipière d'alice en 2v2, observatrice en 1v1
    tokE, idE, _ = register("erin")  # promue admin via SQL
    CHESS = ladder_id(tokA, "chess", "1v1")
    for t in (tokA, tokB, tokC):
        link(t, "chess_com")
        link(t, "riot")  # requis par la section 2v2 (ladder val)
    sql(f"update users set is_admin=true where id='{idE}';")

    # ─────────────────────────────────────────────── Gardes REST
    s.section("Gardes REST")
    st, _ = get_notifs(None)
    s.check("GET /notifications sans token -> 401", st, 401)
    st, _ = req("PATCH", f"/notifications/{uuid.uuid4()}/read")
    s.check("PATCH /:id/read sans token -> 401", st, 401)
    st, _ = req("PATCH", "/notifications/read-all")
    s.check("PATCH /read-all sans token -> 401", st, 401)
    st, _ = get_notifs(tokA, "?limit=0")
    s.check("limit=0 -> 400", st, 400)
    st, _ = get_notifs(tokA, "?cursor=notauuid")
    s.check("cursor non-uuid -> 400", st, 400)
    st, _ = req("PATCH", "/notifications/notauuid/read", tokA)
    s.check("PATCH /:id/read id non-uuid -> 400", st, 400)

    st, b = get_notifs(tokA)
    s.check("état initial -> 200, 0 notif", (st, b.get("notifications"), b.get("unreadCount"), b.get("nextCursor")), (200, [], 0, None))

    # ─────────────────────────────────────────────── match_accepted (1v1)
    s.section("match_accepted — l'accept notifie le créateur, jamais l'acteur")
    M1 = start_match(tokA, tokB, CHESS)
    s1_0, s1_1 = side_id(M1, 0), side_id(M1, 1)

    _, bA = get_notifs(tokA)
    acc = of_type(bA, "match_accepted", M1)
    s.check("alice (créatrice) reçoit match_accepted", len(acc), 1)
    n = acc[0] if acc else {}
    s.check("data porte matchId + ladderId", (n.get("data", {}).get("matchId"), n.get("data", {}).get("ladderId")), (M1, CHESS))
    s.check("data porte scheduledAt (heure du match)", "scheduledAt" in n.get("data", {}), True)
    s.check("notif non lue (readAt null)", n.get("readAt"), None)
    s.check("unreadCount alice = 1", bA.get("unreadCount"), 1)
    s.check("clés de la notif = exactement id/type/data/readAt/createdAt", set(n.keys()), NOTIF_KEYS)
    leaked = [f for f in PRIVATE_FIELDS if f in str(bA)]
    s.check("aucun champ privé dans la réponse", leaked, [])

    _, bB = get_notifs(tokB)
    s.check("bob (l'acteur de l'accept) n'a RIEN", len(bB.get("notifications", [])), 0)

    # ─────────────────────────────────────────────── result_submitted / result_confirmed (1v1)
    s.section("result_submitted (l'autre camp) / result_confirmed (tous sauf l'acteur)")
    backdate_sched(M1)
    req("POST", f"/matches/{M1}/result", tokB, {"winnerSideId": s1_1, "scoreSelf": 2, "scoreOpponent": 0})  # bob soumet le 1er

    _, bA = get_notifs(tokA)
    s.check("alice (l'autre camp) reçoit result_submitted", len(of_type(bA, "result_submitted", M1)), 1)
    _, bB = get_notifs(tokB)
    s.check("bob (soumetteur) n'est pas notifié", len(bB.get("notifications", [])), 0)

    req("POST", f"/matches/{M1}/result", tokA, {"winnerSideId": s1_1, "scoreSelf": 0, "scoreOpponent": 2})  # alice confirme -> completed
    s.check("le match est bien completed", status_of(M1), "completed")
    _, bB = get_notifs(tokB)
    conf = of_type(bB, "result_confirmed", M1)
    s.check("bob reçoit result_confirmed", len(conf), 1)
    s.check("data porte winnerSideId", (conf[0].get("data", {}).get("winnerSideId") if conf else None), s1_1)
    _, bA = get_notifs(tokA)
    s.check("alice (actrice de la confirmation) ne reçoit PAS result_confirmed", len(of_type(bA, "result_confirmed", M1)), 0)

    # ─────────────────────────────────────────────── re-soumission avant réponse -> pas de spam
    # (review B9 #1 — bloquant) : tant que l'adversaire n'a pas soumis, `otherSide.submittedAt`
    # reste null à CHAQUE nouvel appel du même camp -> sans garde, chaque re-soumission
    # renvoyait une notif result_submitted en plus. Une seule doit survivre.
    s.section("re-soumission (même camp, adversaire toujours muet) -> UNE SEULE notif")
    M4 = start_match(tokA, tokB, CHESS)
    s4_0, s4_1 = side_id(M4, 0), side_id(M4, 1)
    backdate_sched(M4)
    req("POST", f"/matches/{M4}/result", tokA, {"winnerSideId": s4_0, "scoreSelf": 2, "scoreOpponent": 0})  # 1re soumission
    req("POST", f"/matches/{M4}/result", tokA, {"winnerSideId": s4_0, "scoreSelf": 2, "scoreOpponent": 0})  # re-soumission, même vainqueur
    req("POST", f"/matches/{M4}/result", tokA, {"winnerSideId": s4_1, "scoreSelf": 0, "scoreOpponent": 2})  # re-soumission, alice change d'avis
    _, bB = get_notifs(tokB)
    s.check(
        "bob a reçu 3 soumissions d'alice mais UNE seule notif result_submitted",
        len(of_type(bB, "result_submitted", M4)),
        1,
    )
    st, b = req("POST", f"/matches/{M4}/result", tokB, {"winnerSideId": s4_1, "scoreSelf": 2, "scoreOpponent": 0})  # bob confirme -> completed
    s.check("le match se termine normalement malgré les re-soumissions", (st, b.get("status")), (200, "completed"))

    # ─────────────────────────────────────────────── dispute_opened + dispute_needs_admin
    s.section("dispute : les deux camps (sauf l'acteur) + TOUS les admins")
    M2 = start_match(tokA, tokB, CHESS)
    s2_0, s2_1 = side_id(M2, 0), side_id(M2, 1)
    backdate_sched(M2)
    req("POST", f"/matches/{M2}/result", tokA, {"winnerSideId": s2_0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{M2}/result", tokB, {"winnerSideId": s2_1, "scoreSelf": 2, "scoreOpponent": 0})  # bob crée le désaccord
    s.check("le match est bien disputed", status_of(M2), "disputed")
    DISP = sql(f"select id from disputes where match_id='{M2}';")

    _, bA = get_notifs(tokA)
    op = of_type(bA, "dispute_opened", M2)
    s.check("alice reçoit dispute_opened", len(op), 1)
    s.check("data porte disputeId", (op[0].get("data", {}).get("disputeId") if op else None), DISP)
    _, bB = get_notifs(tokB)
    s.check("bob (acteur du désaccord) ne reçoit PAS dispute_opened", len(of_type(bB, "dispute_opened", M2)), 0)
    _, bE = get_notifs(tokE)
    s.check("erin (admin) reçoit dispute_needs_admin", len(of_type(bE, "dispute_needs_admin", M2)), 1)
    _, bC = get_notifs(tokC)
    s.check("carol (ni camp ni admin) n'a rien", len(bC.get("notifications", [])), 0)

    # ─────────────────────────────────────────────── dispute_resolved
    s.section("dispute_resolved — les deux camps, pas l'arbitre")
    st, _ = req("POST", f"/disputes/{DISP}/resolve", tokE, {"resolution": "side_0_wins"})
    s.check("l'admin résout -> 200", st, 200)
    _, bA = get_notifs(tokA)
    res = of_type(bA, "dispute_resolved", M2)
    s.check("alice reçoit dispute_resolved", len(res), 1)
    s.check("data porte la resolution", (res[0].get("data", {}).get("resolution") if res else None), "side_0_wins")
    _, bB = get_notifs(tokB)
    s.check("bob reçoit dispute_resolved", len(of_type(bB, "dispute_resolved", M2)), 1)
    _, bE = get_notifs(tokE)
    s.check("erin (l'arbitre) ne se notifie pas elle-même", len(of_type(bE, "dispute_resolved", M2)), 0)

    # ─────────────────────────────────────────────── read / read-all
    # Total d'alice à ce stade = 7 : match_accepted(M1), result_submitted(M1),
    # match_accepted(M4) + result_confirmed(M4) [section re-soumission], dispute_opened(M2),
    # dispute_resolved(M2) — 6... + en fait 7 car M4 génère AUSSI un match_accepted (voir
    # section re-soumission : start_match crée+accepte M4 avant les 3 soumissions).
    s.section("PATCH /:id/read et /read-all — mienne only, idempotence")
    _, bA = get_notifs(tokA)
    alice_notifs = bA.get("notifications", [])
    unread_before = bA.get("unreadCount")
    s.check("alice a 7 notifs, toutes non lues", (len(alice_notifs), unread_before), (7, 7))

    first = alice_notifs[0]["id"] if alice_notifs else str(uuid.uuid4())
    st, _ = req("PATCH", f"/notifications/{first}/read", tokA)
    s.check("marquer une notif lue -> 200", st, 200)
    _, bA = get_notifs(tokA)
    s.check("unreadCount décrémenté", bA.get("unreadCount"), 6)
    read_at_1 = next((n.get("readAt") for n in bA.get("notifications", []) if n.get("id") == first), None)
    s.check("readAt posé", read_at_1 is not None, True)

    st, _ = req("PATCH", f"/notifications/{first}/read", tokA)
    s.check("re-marquer -> 200 (idempotent)", st, 200)
    _, bA = get_notifs(tokA)
    read_at_2 = next((n.get("readAt") for n in bA.get("notifications", []) if n.get("id") == first), None)
    s.check("readAt INCHANGÉ (1re lecture conservée)", read_at_2, read_at_1)

    bob_notif = get_notifs(tokB)[1]["notifications"][0]["id"]
    st, _ = req("PATCH", f"/notifications/{bob_notif}/read", tokA)
    s.check("la notif de bob via alice -> 404 (pas d'oracle)", st, 404)
    st, _ = req("PATCH", f"/notifications/{uuid.uuid4()}/read", tokA)
    s.check("id inconnu -> 404", st, 404)

    st, b = req("PATCH", "/notifications/read-all", tokA)
    s.check("read-all -> 200, 6 marquées", (st, b.get("updated")), (200, 6))
    _, bA = get_notifs(tokA)
    s.check("unreadCount = 0", bA.get("unreadCount"), 0)
    st, b = req("PATCH", "/notifications/read-all", tokA)
    s.check("re-read-all -> 200, 0 marquée (idempotent)", (st, b.get("updated")), (200, 0))

    # ─────────────────────────────────────────────── pagination par curseur
    s.section("GET /notifications — tri desc + pagination par curseur")
    _, bA = get_notifs(tokA)
    dates = [n["createdAt"] for n in bA.get("notifications", [])]
    s.check("tri : plus récentes d'abord", dates, sorted(dates, reverse=True))
    s.check("page complète implicite (7 < 20) -> nextCursor null", bA.get("nextCursor"), None)

    # 7 notifs, limit=3 -> page1=3 (reste 4), page2=3 (reste 1), page3=1 (reste 0)
    _, p1 = get_notifs(tokA, "?limit=3")
    s.check("limit=3 -> 3 notifs + curseur", (len(p1.get("notifications", [])), p1.get("nextCursor") is not None), (3, True))
    _, p2 = get_notifs(tokA, f"?limit=3&cursor={p1.get('nextCursor')}")
    ids1 = {n["id"] for n in p1.get("notifications", [])}
    ids2 = {n["id"] for n in p2.get("notifications", [])}
    s.check("page 2 -> encore 3, sans doublon avec la page 1", (len(ids2), ids1 & ids2), (3, set()))
    s.check("page 2 pleine -> nextCursor non null (il reste 1)", p2.get("nextCursor") is not None, True)
    _, p3 = get_notifs(tokA, f"?limit=3&cursor={p2.get('nextCursor')}")
    ids3 = {n["id"] for n in p3.get("notifications", [])}
    s.check(
        "page 3 -> le dernier reliquat (1), sans doublon, nextCursor null",
        (len(ids3), (ids1 | ids2) & ids3, p3.get("nextCursor")),
        (1, set(), None),
    )

    st, _ = get_notifs(tokA, f"?cursor={uuid.uuid4()}")
    s.check("curseur inconnu -> 400", st, 400)
    st, _ = get_notifs(tokA, f"?cursor={bob_notif}")
    s.check("curseur d'un AUTRE user -> le même 400 (pas d'oracle)", st, 400)

    # ─────────────────────────────────────────────── pagination — multiple EXACT de limit
    # (review B9 #3 — mineur) : `length === limit` ne distingue pas « il en reste » de
    # « il en restait pile limit » -> nextCursor pointait vers une page suivante VIDE.
    # Compte de départ (0 notif) obligatoire pour raisonner sur un total exact -> user neuf.
    s.section("pagination — nextCursor correct sur un multiple EXACT de limit")
    tokF, idF, _ = register("carol")  # compte neuf, isolé, juste pour ce compte exact
    # Accepteur DÉDIÉ (pas tokB) : ces 3 matchs restent `in_progress` (jamais résolus) et
    # occuperaient sinon le planning de bob jusqu'à +3h -> la section Jobs plus bas, qui crée
    # MG/MC/MD sur l'heure PAR DÉFAUT (+1h), se ferait refuser l'accept par bob (409 §5.2,
    # jamais vérifié par le test) et resterait bloquée en `pending` -> ramassée par le job
    # d'expiration de slot au lieu du job de test visé. (Bug trouvé le 20/07 : MG/MC/MD ne
    # dépassaient jamais `pending`, donc aucune des 3 assertions de jobs n'avait de sens.)
    tokG, idG, _ = register("dave")
    link(tokG, "chess_com")
    link(tokF, "chess_com")
    N = 3
    for i in range(N):
        start_match(tokF, tokG, CHESS, at=future(hours=i + 1))  # dave accepte -> frank reçoit match_accepted
    _, bF = get_notifs(tokF, f"?limit={N}")
    s.check(
        f"{N} notifs, limit={N} pile -> nextCursor null (pas de page suivante vide)",
        (len(bF.get("notifications", [])), bF.get("nextCursor")),
        (N, None),
    )
    _, bF2 = get_notifs(tokF, f"?limit={N - 1}")
    s.check(f"limit={N - 1} < total -> nextCursor non null", bF2.get("nextCursor") is not None, True)
    _, bF3 = get_notifs(tokF, f"?limit={N - 1}&cursor={bF2.get('nextCursor')}")
    s.check(
        "page suivante -> exactement le reliquat (1), nextCursor null",
        (len(bF3.get("notifications", [])), bF3.get("nextCursor")),
        (1, None),
    )

    # ─────────────────────────────────────────────── fan-out 2v2 : alignés oui, banc non
    s.section("2v2 — fan-out lineup, banc exclu, coéquipiers de l'acteur notifiés")
    tokD1, idD1, _ = register("dave")  # banc de la team A
    tokD2, idD2, _ = register("dave")  # aligné de la team B
    for t in (tokD1, tokD2):
        link(t, "riot")
    VAL2 = ladder_id(tokA, "val", "2v2")

    ta = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "A" + uuid.uuid4().hex[:6]})[1]["team"]["id"]
    join_team(ta, idC)
    join_team(ta, idD1)
    tb = req("POST", "/teams", tokB, {"ladderId": VAL2, "name": "B" + uuid.uuid4().hex[:6]})[1]["team"]["id"]
    join_team(tb, idD2)

    _, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idC]})
    M3 = b["match"]["id"]
    st, _ = req("POST", f"/matches/{M3}/accept", tokB, {"lineup": [idB, idD2]})
    s.check("team B accepte -> 200", st, 200)
    s3_0 = side_id(M3, 0)

    s.check("alice (alignée A) reçoit match_accepted", len(of_type(get_notifs(tokA)[1], "match_accepted", M3)), 1)
    s.check("carol (alignée A) reçoit match_accepted", len(of_type(get_notifs(tokC)[1], "match_accepted", M3)), 1)
    s.check("dave1 (BANC de A) ne reçoit rien sur ce match", len(of_match(get_notifs(tokD1)[1], M3)), 0)
    s.check("bob (capitaine accepteur = acteur) rien", len(of_type(get_notifs(tokB)[1], "match_accepted", M3)), 0)
    s.check("dave2 (aligné B, camp de l'acteur) rien", len(of_type(get_notifs(tokD2)[1], "match_accepted", M3)), 0)

    backdate_sched(M3)
    req("POST", f"/matches/{M3}/result", tokB, {"winnerSideId": s3_0, "scoreSelf": 0, "scoreOpponent": 2})  # bob (cap B) soumet le 1er
    s.check("alice (autre camp) reçoit result_submitted", len(of_type(get_notifs(tokA)[1], "result_submitted", M3)), 1)
    s.check("carol (autre camp) reçoit result_submitted", len(of_type(get_notifs(tokC)[1], "result_submitted", M3)), 1)
    s.check("dave2 (coéquipier du soumetteur) rien — seul l'AUTRE camp confirme", len(of_type(get_notifs(tokD2)[1], "result_submitted", M3)), 0)

    req("POST", f"/matches/{M3}/result", tokA, {"winnerSideId": s3_0, "scoreSelf": 2, "scoreOpponent": 0})  # alice confirme -> completed
    s.check("match completed", status_of(M3), "completed")
    s.check("carol (coéquipière de l'actrice) reçoit result_confirmed", len(of_type(get_notifs(tokC)[1], "result_confirmed", M3)), 1)
    s.check("bob reçoit result_confirmed", len(of_type(get_notifs(tokB)[1], "result_confirmed", M3)), 1)
    s.check("dave2 reçoit result_confirmed", len(of_type(get_notifs(tokD2)[1], "result_confirmed", M3)), 1)
    s.check("alice (actrice) ne le reçoit pas", len(of_type(get_notifs(tokA)[1], "result_confirmed", M3)), 0)
    s.check("dave1 (banc) toujours rien sur ce match", len(of_match(get_notifs(tokD1)[1], M3)), 0)

    # ─────────────────────────────────────────────── jobs 24 h (opt-in, +65 s)
    if os.environ.get("B9_JOBS"):
        s.section("Jobs 24h — fantôme / auto-confirm / dispute auto-annulée (B9_JOBS=1)")

        # Fantôme : in_progress + scheduled_at -25 h -> le job annule.
        MG = start_match(tokA, tokB, CHESS)
        backdate_sched(MG, "25 hours")

        # Auto-confirm : backdate -1 h (assez pour soumettre, PAS assez pour être un fantôme :
        # backdater -25 h AVANT la soumission ouvrirait une course avec le tick, qui pourrait
        # l'annuler en fantôme entre le backdate et le POST). Puis on vieillit la soumission.
        MC = start_match(tokA, tokB, CHESS)
        backdate_sched(MC, "1 hour")
        req("POST", f"/matches/{MC}/result", tokA, {"winnerSideId": side_id(MC, 0), "scoreSelf": 2, "scoreOpponent": 0})
        # Soumission faite -> on vieillit AUSSI scheduled_at : sinon la fenêtre §5.2 de MC
        # (récente) pourrait bloquer la création/accept de MD selon le lockout du ladder.
        backdate_sched(MC, "25 hours")
        sql(f"update match_sides set submitted_at = now() - interval '25 hours' where match_id='{MC}' and submitted_at is not null;")

        # Dispute auto-annulée : désaccord -> disputed, puis on vieillit la dispute.
        MD = start_match(tokA, tokB, CHESS)
        backdate_sched(MD, "1 hour")
        req("POST", f"/matches/{MD}/result", tokA, {"winnerSideId": side_id(MD, 0), "scoreSelf": 2, "scoreOpponent": 0})
        req("POST", f"/matches/{MD}/result", tokB, {"winnerSideId": side_id(MD, 1), "scoreSelf": 2, "scoreOpponent": 0})
        sql(f"update disputes set created_at = now() - interval '25 hours' where match_id='{MD}';")

        print("   ⏳ attente du tick du planificateur (65 s)…")
        time.sleep(65)

        s.check("fantôme annulé", status_of(MG), "cancelled")
        s.check("alice reçoit match_ghost_cancelled", len(of_type(get_notifs(tokA)[1], "match_ghost_cancelled", MG)), 1)
        s.check("bob reçoit match_ghost_cancelled", len(of_type(get_notifs(tokB)[1], "match_ghost_cancelled", MG)), 1)

        s.check("auto-confirmé", status_of(MC), "completed")
        s.check("alice reçoit result_confirmed (job : PAS d'acteur, soumetteur inclus)", len(of_type(get_notifs(tokA)[1], "result_confirmed", MC)), 1)
        s.check("bob reçoit result_confirmed", len(of_type(get_notifs(tokB)[1], "result_confirmed", MC)), 1)

        s.check("dispute auto-annulée -> match cancelled", status_of(MD), "cancelled")
        s.check("dispute resolved/cancelled", sql(f"select status || '/' || resolution from disputes where match_id='{MD}';"), "resolved/cancelled")
        s.check("alice reçoit dispute_auto_cancelled", len(of_type(get_notifs(tokA)[1], "dispute_auto_cancelled", MD)), 1)
        s.check("bob reçoit dispute_auto_cancelled", len(of_type(get_notifs(tokB)[1], "dispute_auto_cancelled", MD)), 1)
    else:
        s.section("Jobs 24h — SKIP (mettre B9_JOBS=1 pour les tester, +65s)")

    return s.report()


if __name__ == "__main__":
    run()
