"""B5b — POST /matches (création de slot) : les 8 gardes de validateSide,
l'anonymat de la liste, et le détail réservé aux participants."""

import uuid

from helpers import Suite, future, ladder_id, link, past, register, req, sql


def run():
    s = Suite("B5b — POST /matches : création, liste, détail")

    tokA, idA, pA = register("alice")  # capitaine / joueur solo
    tokB, idB, pB = register("bob")  # membre du roster
    tokC, idC, pC = register("carol")  # sans team, et SANS compte riot (volontaire)

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")

    # ─────────────────────────── SOLO (chess 1v1 · provider chess_com)
    s.section("SOLO — chess 1v1 (provider chess_com, pas de pool de maps)")

    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("§5.1 compte non lié → 400", st, 400, b.get("error", ""))

    link(tokA, "chess_com")
    link(tokB, "chess_com")

    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("création solo → 201", st, 201)
    M1 = b.get("match", {}).get("id")
    s.check("chess n'a pas de pool → maps == []", b.get("match", {}).get("maps"), [])

    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("2e slot ouvert → 409", st, 409, b.get("error", ""))

    st, _ = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": past()})
    s.check("scheduledAt dans le passé → 400", st, 400)

    st, b = req("GET", f"/matches?ladderId={CHESS}", tokA)
    s.check("ma liste exclut mon propre slot", M1 in [x["id"] for x in b.get("slots", [])], False)

    st, b = req("GET", f"/matches?ladderId={CHESS}", tokB)
    slots = b.get("slots", [])
    s.check("un autre joueur voit mon slot", M1 in [x["id"] for x in slots], True)
    if slots:
        s.check(
            "anonymat : ni team créatrice ni maps",
            sorted(slots[0].keys()),
            ["format", "gameId", "id", "scheduledAt"],
        )

    st, _ = req("GET", f"/matches/{M1}", tokB)
    s.check("détail par un non-participant → 403", st, 403)
    st, _ = req("GET", f"/matches/{M1}", tokA)
    s.check("détail par le créateur → 200", st, 200)

    st, b = req("GET", f"/matches?ladderId={uuid.uuid4()}", tokA)
    s.check("ladder inconnu → 404", st, 404, b.get("error", ""))

    # ─────────────────────────── TEAM (val 2v2 · provider riot)
    s.section("TEAM — val 2v2 (provider riot, pool de 6 maps)")

    link(tokA, "riot")
    link(tokB, "riot")
    # ⚠️ carol ne lie PAS riot → elle servira à tester le §5.1 côté team

    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "B5b" + uuid.uuid4().hex[:5]})
    TEAM = (b.get("team") or b).get("id")
    s.check("création de la team → 201", st, 201)
    st, _ = req("POST", f"/teams/{TEAM}/members", tokA, {"userId": idB})
    s.check("bob ajouté au roster → 201", st, 201)

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future()})
    s.check("lineup absente sur un ladder team → 400", st, 400, b.get("error", ""))

    st, b = req("POST", "/matches", tokC, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idC, idA]})
    s.check("pas de team sur ce ladder → 400", st, 400, b.get("error", ""))

    st, b = req("POST", "/matches", tokB, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("non-capitaine → 403", st, 403, b.get("error", ""))

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA]})
    s.check("lineup de taille 1 (2 requis) → 400", st, 400, b.get("error", ""))

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idC]})
    s.check("joueur hors du roster → 400", st, 400, b.get("error", ""))

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("création team par le capitaine → 201", st, 201)
    M2 = b.get("match", {}).get("id")
    maps = b.get("match", {}).get("maps", [])
    s.check("valorant → 3 maps tirées", len(maps), 3, str(maps))
    s.check("les 3 maps sont distinctes", len(set(maps)), 3)

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("la team a déjà un slot ouvert → 409", st, 409, b.get("error", ""))

    st, b = req("GET", f"/matches?ladderId={VAL2}", tokA)
    s.check("la liste exclut le slot de ma team", M2 in [x["id"] for x in b.get("slots", [])], False)
    st, b = req("GET", f"/matches?ladderId={VAL2}", tokC)
    s.check("un joueur sans team voit le slot", M2 in [x["id"] for x in b.get("slots", [])], True)

    # §5.1 côté team : carol est dans le roster mais n'a pas lié riot
    st, _ = req("POST", f"/teams/{TEAM}/members", tokA, {"userId": idC})
    s.check("carol ajoutée au roster (sans compte riot) → 201", st, 201)
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idC]})
    s.check("§5.1 joueur de la lineup sans compte lié → 400", st, 400, b.get("error", ""))
    s.check("le 400 nomme les fautifs (unlinkedPlayers)", b.get("unlinkedPlayers"), [idC])

    # §5.2 lockout côté team : seuls les matchs ACTIFS verrouillent
    sql(f"update matches set status='in_progress', started_at=now() where id='{M2}';")
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("§5.2 team dans un match ACTIF → 409 lockout", st, 409, b.get("error", ""))

    sql(f"update matches set status='completed' where id='{M2}';")
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idB]})
    s.check("§5.2 match completed → 201 (la team est libérée)", st, 201, b.get("error", ""))

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
