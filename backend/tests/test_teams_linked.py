"""B5c — GET /teams/:id expose `hasLinkedAccount` par membre.

« Compte lié » n'a de sens que RELATIVEMENT À UN JEU : la chaîne
team → ladder → game → required_provider donne le provider à vérifier.
Un joueur peut donc être sélectionnable dans une team (CS2/steam) et grisé
dans une autre (Valorant/riot). D'où le booléen sur le membre D'UNE TEAM,
et non sur l'utilisateur.

C'est ce qui permet au front de griser les joueurs non sélectionnables
AVANT que le capitaine ne compose sa lineup (prévenir plutôt que refuser).
"""

import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req


def run():
    s = Suite("B5c — hasLinkedAccount (GET /teams/:id) + unlinkedPlayers (400)")

    tokA, idA, pA = register("alice")  # capitaine — riot lié
    tokB, idB, pB = register("bob")  # membre    — riot lié
    tokC, idC, pC = register("carol")  # membre    — STEAM lié, mais PAS riot

    VAL2 = ladder_id(tokA, "val", "2v2")
    link(tokA, "riot")
    link(tokB, "riot")
    link(tokC, "steam")  # ⚠️ elle a bien UN compte lié… mais pas celui du bon jeu

    _, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Sniper" + uuid.uuid4().hex[:5]})
    TEAM = (b.get("team") or b).get("id")
    join_team(TEAM, idB)
    join_team(TEAM, idC)

    s.section("GET /teams/:id — ce que le front doit afficher")
    st, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check("le jeu de la team impose 'riot'", b["team"].get("requiredProvider"), "riot")

    linked = {m["pseudo"]: m.get("hasLinkedAccount") for m in b["members"]}
    s.check(f"{pA} (riot lié) → sélectionnable", linked.get(pA), True)
    s.check(f"{pB} (riot lié) → sélectionnable", linked.get(pB), True)
    s.check(f"{pC} (steam lié, PAS riot) → grisé", linked.get(pC), False)

    s.section("POST /matches — le 400 dit QUI pose problème")
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idA, idC]})
    s.check("lineup contenant un joueur non lié → 400", st, 400, b.get("error", ""))
    s.check("le 400 nomme le fautif", b.get("unlinkedPlayers"), [idC])

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
