"""B5c — POST /matches/:id/accept : engager le 2e côté d'un slot ouvert.

Trois choses se jouent ici, et aucune n'était testable avant :
  1. `validateSide` est RÉUTILISÉ pour le side 1 → les deux camps subissent les
     mêmes règles (§5.1 compte lié, capitaine, lineup).
  2. L'accept pose `started_at` → le lockout §5.2, DORMANT depuis B5b, s'arme.
  3. Option A : les slots encore ouverts des deux camps sont annulés, sinon une
     3e équipe les accepterait et on aurait deux matchs actifs en parallèle.

Le piège central : « ne pas accepter son propre slot » se vérifie par TEAM en 2v2+,
mais par JOUEUR en 1v1 — les deux sides y ont `team_id = NULL`.
"""

import uuid

from helpers import Suite, future, ladder_id, link, register, req, sql


def side1_team(match):
    return sql(f"select coalesce(team_id::text, 'NULL') from match_sides where match_id='{match}' and side_index=1;")


def side1_players(match):
    return sql(
        "select count(*) from match_participants p join match_sides s on s.id = p.match_side_id "
        f"where s.match_id='{match}' and s.side_index=1;"
    )


def status_of(match):
    return sql(f"select status from matches where id='{match}';")


def started(match):
    return sql(f"select started_at is not null from matches where id='{match}';")


def run():
    s = Suite("B5c — POST /matches/:id/accept")

    tokA, idA, _ = register("alice")  # créateur solo + capitaine team A
    tokB, idB, _ = register("bob")  # accepteur solo + membre team A (non capitaine)
    tokC, idC, _ = register("carol")  # capitaine team B (l'adversaire)
    tokD, idD, _ = register("dave")  # membre team B (non capitaine)
    tokE, _, _ = register("erin")  # PAS de compte chess_com lié → doit être refusé

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")
    for t in (tokA, tokB, tokC, tokD):
        link(t, "chess_com")
        link(t, "riot")
    link(tokE, "riot")  # erin a riot mais PAS chess_com

    # ─────────────────────────────────────────────── SOLO (chess 1v1)
    s.section("SOLO — le piège : l'auto-accept se détecte par JOUEUR, pas par team")

    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M1 = b["match"]["id"]
    s.check("alice ouvre un slot solo → 201", st, 201)

    st, b = req("POST", f"/matches/{M1}/accept", tokA)
    s.check("alice accepte SON PROPRE slot → 400", st, 400, b.get("error", ""))
    s.check("le match est resté pending", status_of(M1), "pending")

    st, b = req("POST", f"/matches/{M1}/accept", tokE)
    s.check("erin (pas de compte chess_com) → 400 §5.1", st, 400, b.get("error", ""))

    # bob a lui aussi un slot ouvert : il devra être annulé quand il acceptera (option A)
    st, b = req("POST", "/matches", tokB, {"ladderId": CHESS, "scheduledAt": future()})
    M_BOB = b["match"]["id"]
    s.check("bob ouvre son propre slot (pour tester l'option A) → 201", st, 201)

    st, b = req("POST", f"/matches/{M1}/accept", tokB)
    s.check("bob accepte le slot d'alice → 200", st, 200, b.get("error", ""))
    s.check("le match est in_progress", status_of(M1), "in_progress")
    s.check("started_at est posé (→ le lockout s'arme)", started(M1), "t")
    s.check("le side 1 existe, sans team (solo)", side1_team(M1), "NULL")
    s.check("le side 1 a exactement 1 joueur", side1_players(M1), "1")

    s.section("SOLO — option A : le slot ouvert de l'accepteur tombe")
    s.check("le slot ouvert de bob est annulé", status_of(M_BOB), "cancelled")

    s.section("SOLO — le lockout §5.2, enfin armé")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("alice (en match) rouvre un slot chess → 409", st, 409, b.get("error", ""))
    st, b = req("POST", "/matches", tokB, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("bob (en match) rouvre un slot chess → 409", st, 409, b.get("error", ""))

    st, b = req("POST", f"/matches/{M1}/accept", tokC)
    s.check("carol accepte un match déjà pris → 409", st, 409, b.get("error", ""))

    # ─────────────────────────────────────────────── erreurs
    s.section("Erreurs")
    st, b = req("POST", f"/matches/{uuid.uuid4()}/accept", tokB)
    s.check("id inexistant → 404", st, 404, b.get("error", ""))
    st, _ = req("POST", "/matches/pas-un-uuid/accept", tokB)
    s.check("id non-uuid → 400", st, 400)

    # on libère le lockout d'alice pour pouvoir remonter un slot chess
    sql(f"update matches set status='completed' where id='{M1}';")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M2 = b["match"]["id"]
    s.check("match terminé → alice peut rouvrir (lockout libéré)", st, 201, b.get("error", ""))
    req("DELETE", f"/matches/{M2}", tokA)
    st, b = req("POST", f"/matches/{M2}/accept", tokB)
    s.check("accepter un slot annulé → 409", st, 409, b.get("error", ""))

    # ─────────────────────────────────────────────── TEAM (val 2v2)
    s.section("TEAM — l'auto-accept se détecte par TEAM")

    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Acc" + uuid.uuid4().hex[:5]})
    TEAM_A = (b.get("team") or b).get("id")
    s.check("team A créée (capitaine alice) → 201", st, 201)
    req("POST", f"/teams/{TEAM_A}/members", tokA, {"userId": idB})

    st, b = req("POST", "/teams", tokC, {"ladderId": VAL2, "name": "Acc" + uuid.uuid4().hex[:5]})
    TEAM_B = (b.get("team") or b).get("id")
    s.check("team B créée (capitaine carol) → 201", st, 201)
    req("POST", f"/teams/{TEAM_B}/members", tokC, {"userId": idD})

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    M3 = b["match"]["id"]
    s.check("team A ouvre un slot 2v2 → 201", st, 201)

    st, b = req("POST", f"/matches/{M3}/accept", tokA, {"lineup": [idA, idB]})
    s.check("alice accepte LE SLOT DE SA PROPRE TEAM → 400", st, 400, b.get("error", ""))
    s.check("le match est resté pending", status_of(M3), "pending")

    st, b = req("POST", f"/matches/{M3}/accept", tokB, {"lineup": [idA, idB]})
    s.check("bob (membre, pas capitaine) accepte → 403", st, 403, b.get("error", ""))
    st, b = req("POST", f"/matches/{M3}/accept", tokD, {"lineup": [idC, idD]})
    s.check("dave (membre team B, pas capitaine) accepte → 403", st, 403, b.get("error", ""))
    st, b = req("POST", f"/matches/{M3}/accept", tokC)
    s.check("carol accepte SANS lineup → 400", st, 400, b.get("error", ""))

    # team B a son propre slot ouvert : il doit tomber à l'accept (option A)
    st, b = req("POST", "/matches", tokC, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idC, idD]})
    M_TEAMB = b["match"]["id"]
    s.check("team B ouvre son propre slot (pour tester l'option A) → 201", st, 201)

    st, b = req("POST", f"/matches/{M3}/accept", tokC, {"lineup": [idC, idD]})
    s.check("carol (capitaine team B) accepte → 200", st, 200, b.get("error", ""))
    s.check("le match est in_progress", status_of(M3), "in_progress")
    s.check("started_at est posé", started(M3), "t")
    s.check("le side 1 porte bien la team B", side1_team(M3), TEAM_B)
    s.check("le side 1 a exactement 2 joueurs", side1_players(M3), "2")

    s.section("TEAM — option A : le slot ouvert de la team accepteuse tombe")
    s.check("le slot ouvert de team B est annulé", status_of(M_TEAMB), "cancelled")

    s.section("TEAM — lockout §5.2 armé pour les deux camps")
    st, b = req("POST", "/matches", tokC, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idC, idD]})
    s.check("team B (en match) rouvre un slot → 409", st, 409, b.get("error", ""))
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("team A (en match) rouvre un slot → 409", st, 409, b.get("error", ""))

    st, b = req("POST", f"/matches/{M3}/accept", tokC, {"lineup": [idC, idD]})
    s.check("ré-accepter un match déjà pris → 409", st, 409, b.get("error", ""))

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()