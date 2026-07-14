"""B5c — DELETE /matches/:id : annuler son propre slot ouvert.

On n'efface pas la ligne : on passe le match à `cancelled` (l'historique est conservé).
Le créateur, c'est le side_index 0 — capitaine de sa team (2v2+) ou participant (1v1).
"""

import uuid

from helpers import Suite, future, ladder_id, link, register, req, sql


def run():
    s = Suite("B5c — DELETE /matches/:id (annuler son slot)")

    tokA, idA, pA = register("alice")  # créateur (solo + capitaine)
    tokB, idB, pB = register("bob")  # membre du roster, NON capitaine
    tokC, idC, pC = register("carol")  # totalement étranger

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")
    for t in (tokA, tokB, tokC):
        link(t, "chess_com")
        link(t, "riot")

    # ─────────────────────────── SOLO
    s.section("SOLO")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M1 = b["match"]["id"]
    s.check("slot solo créé → 201", st, 201)

    st, b = req("DELETE", f"/matches/{M1}", tokC)
    s.check("un inconnu tente d'annuler → 403", st, 403, b.get("error", ""))

    st, _ = req("DELETE", f"/matches/{M1}", tokA)
    s.check("le créateur annule → 200", st, 200)
    s.check("le match est `cancelled` en base", sql(f"select status from matches where id='{M1}';"), "cancelled")

    st, _ = req("DELETE", f"/matches/{M1}", tokA)
    s.check("ré-annuler → 200 (idempotent)", st, 200)

    st, b = req("GET", f"/matches?ladderId={CHESS}", tokB)
    s.check("le slot annulé disparaît de la liste", M1 in [x["id"] for x in b.get("slots", [])], False)

    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("je peux rouvrir un slot après annulation", st, 201, b.get("error", ""))
    M1b = b.get("match", {}).get("id")

    # ─────────────────────────── TEAM
    s.section("TEAM (val 2v2)")
    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Del" + uuid.uuid4().hex[:5]})
    TEAM = (b.get("team") or b).get("id")
    s.check("team créée → 201", st, 201)
    st, _ = req("POST", f"/teams/{TEAM}/members", tokA, {"userId": idB})
    s.check("bob ajouté au roster → 201", st, 201)
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    M2 = b["match"]["id"]
    s.check("slot team créé par le capitaine → 201", st, 201)

    st, b = req("DELETE", f"/matches/{M2}", tokB)
    s.check("un MEMBRE non-capitaine annule → 403", st, 403, b.get("error", ""))
    st, b = req("DELETE", f"/matches/{M2}", tokC)
    s.check("un inconnu annule → 403", st, 403, b.get("error", ""))
    st, _ = req("DELETE", f"/matches/{M2}", tokA)
    s.check("le CAPITAINE annule → 200", st, 200)
    s.check("le match est `cancelled` en base", sql(f"select status from matches where id='{M2}';"), "cancelled")
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("la team peut rouvrir un slot", st, 201, b.get("error", ""))

    # ─────────────────────────── erreurs & états
    s.section("Erreurs & états")
    st, b = req("DELETE", f"/matches/{uuid.uuid4()}", tokA)
    s.check("id inexistant → 404", st, 404, b.get("error", ""))
    st, _ = req("DELETE", "/matches/pas-un-uuid", tokA)
    s.check("id non-uuid → 400", st, 400)

    # on ne peut pas annuler un match déjà démarré
    sql(f"update matches set status='in_progress', started_at=now() where id='{M1b}';")
    st, b = req("DELETE", f"/matches/{M1b}", tokA)
    s.check("annuler un match in_progress → 409", st, 409, b.get("error", ""))
    s.check(
        "il est resté in_progress (pas écrasé)",
        sql(f"select status from matches where id='{M1b}';"),
        "in_progress",
    )

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
