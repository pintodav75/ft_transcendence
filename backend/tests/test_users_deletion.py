"""BX-DEL — DELETE /users/me : ne refuser QUE si un match est encore en cours.

Le bug d'origine : `match_participants.user_id` était en `on delete restrict` **sans aucune
condition de statut**. Tout joueur ayant été aligné une seule fois — même dans un match
terminé il y a des mois — recevait un **500 opaque** et ne pouvait plus JAMAIS supprimer son
compte. La contrainte est passée en `cascade` (migration 0023) et la règle produit est portée
par une garde explicite dans la route, qui rend **409 `engaged_in_match`** : une FK ne sait
pas lire un statut.

⚠️ Ce que cette suite vérifie et qui n'est PAS qu'une question de code de retour : que la
suppression ne détruit **aucun résultat**. Le match, ses camps, le score, le vainqueur et les
deltas d'Elo doivent survivre au départ d'un joueur — seule la ligne « qui était aligné »
disparaît. C'est ce qui justifie le `cascade` plutôt qu'un `set null` ou un refus.

⚠️ Chaque suppression réussie consomme son user : les cas sont donc écrits avec des comptes
DISTINCTS, et l'ordre n'est pas anodin (on ne peut pas supprimer deux fois le même).
"""

import uuid

from helpers import (
    FIXTURE_PASSWORD,
    Suite,
    join_team,
    ladder_id,
    link,
    register,
    req,
    sql,
    future,
)


def delete_me(token):
    return req("DELETE", "/users/me", token, {"password": FIXTURE_PASSWORD})


def start_match(tok_creator, tok_acceptor, ladder):
    """Crée un slot 1v1 (heure future valide) et le fait accepter -> in_progress."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": future()})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    return m


def side_id(m, idx):
    return sql(f"select id from match_sides where match_id='{m}' and side_index={idx};")


def play_to_completion(m, tok_a, tok_b):
    """Backdate + les deux camps soumettent le MÊME résultat -> `completed`."""
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{m}';")
    s0 = side_id(m, 0)
    req("POST", f"/matches/{m}/result", tok_a, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{m}/result", tok_b, {"winnerSideId": s0, "scoreSelf": 0, "scoreOpponent": 2})
    return s0


def run():
    s = Suite("BX-DEL — DELETE /users/me : engagement dans un match")

    tokA, idA, _ = register("alice")  # joue un match TERMINÉ puis se supprime
    tokB, idB, _ = register("bob")  # son adversaire — reste en vie pour l'inspection SQL
    tokC, idC, _ = register("carol")  # engagée dans un match EN COURS
    tokD, idD, _ = register("dave")  # son adversaire
    tokE, idE, _ = register("erin")  # ouvre un slot `pending` et n'y touche plus
    for t in (tokA, tokB, tokC, tokD, tokE):
        link(t, "chess_com")
    CHESS = ladder_id(tokA, "chess", "1v1")

    # ─────────────────────────────────────── Le bug d'origine : un match TERMINÉ
    s.section("Un match terminé ne bloque PLUS la suppression (le bug de départ)")
    M = start_match(tokA, tokB, CHESS)
    s0 = play_to_completion(M, tokA, tokB)
    s.check("le match est bien completed avant de supprimer", sql(f"select status from matches where id='{M}';"), "completed")

    # L'état AVANT, pour prouver ensuite que rien de tout ça n'a bougé.
    score_before = sql(f"select score from match_sides where id='{s0}';")
    elo_before = sql(f"select elo_delta from match_sides where id='{s0}';")

    st, b = delete_me(tokA)
    s.check(
        "suppression après un match terminé → 200",
        st,
        200,
        f"⚠️ si 500 : la FK match_participants est retombée en `restrict`. Reçu : {b}",
    )
    s.check("l'user a bien disparu", sql(f"select count(*) from users where id='{idA}';"), "0")

    # 🔑 Le cœur du choix `cascade` : la COMPO disparaît, le RÉSULTAT reste.
    s.check(
        "sa ligne de composition est partie (cascade)",
        sql(f"select count(*) from match_participants where user_id='{idA}';"),
        "0",
    )
    s.check("le match existe toujours", sql(f"select count(*) from matches where id='{M}';"), "1")
    s.check("les deux camps existent toujours", sql(f"select count(*) from match_sides where match_id='{M}';"), "2")
    s.check("le vainqueur est intact", sql(f"select winner_side_id from matches where id='{M}';"), s0)
    s.check("le score est intact", sql(f"select score from match_sides where id='{s0}';"), score_before)
    s.check("le delta d'Elo est intact", sql(f"select elo_delta from match_sides where id='{s0}';"), elo_before)
    s.check(
        "le classement de l'adversaire est intact",
        sql(f"select count(*) from rankings where user_id='{idB}' and ladder_id='{CHESS}';"),
        "1",
    )

    # ─────────────────────────────────────── La règle voulue : un match EN COURS
    s.section("Un match non terminé refuse la suppression (409 `engaged_in_match`)")
    LIVE = start_match(tokC, tokD, CHESS)
    st, b = delete_me(tokC)
    s.check("aligné dans un match in_progress → 409", st, 409, b.get("error", ""))
    s.check("… avec le code STABLE attendu", b.get("code"), "engaged_in_match")
    s.check("le compte est toujours là", sql(f"select count(*) from users where id='{idC}';"), "1")

    # Un slot `pending` engage AUSSI : n'importe qui peut encore l'accepter.
    s.section("Un slot ouvert (pending) engage aussi son créateur")
    req("POST", "/matches", tokE, {"ladderId": CHESS, "scheduledAt": future(hours=3)})
    st, b = delete_me(tokE)
    s.check("créateur d'un slot pending → 409", st, 409, b.get("error", ""))
    s.check("… même code", b.get("code"), "engaged_in_match")

    # Le contrôle POSITIF du cas précédent : une fois le match annulé, ça repasse.
    s.section("Contrôle positif : le match annulé, la suppression redevient possible")
    sql(f"update matches set status='cancelled' where id='{LIVE}';")
    st, b = delete_me(tokC)
    s.check(
        "match passé cancelled → 200",
        st,
        200,
        f"⚠️ si 409 : la garde ne regarde pas le STATUT, elle refuse tout match. Reçu : {b}",
    )

    # Les 4 statuts de ENGAGING_STATUSES doivent bloquer, pas seulement les 2 ci-dessus :
    # `awaiting_confirmation` et `disputed` ne sont atteignables que par une soumission de
    # résultat, on les force donc en SQL — comme les autres suites forcent un état
    # inatteignable par l'API. Ce qui est testé ici, c'est la LISTE de la garde.
    s.section("Les 4 statuts engageants bloquent, pas seulement in_progress")
    for st_name in ("awaiting_confirmation", "disputed"):
        tokX, idX, _ = register("alice")
        tokY, _, _ = register("bob")
        link(tokX, "chess_com")
        link(tokY, "chess_com")
        MX = start_match(tokX, tokY, CHESS)
        sql(f"update matches set status='{st_name}' where id='{MX}';")
        st, b = delete_me(tokX)
        s.check(f"match {st_name} → 409", st, 409, b.get("code", ""))
        sql(f"update matches set status='cancelled' where id='{MX}';")

    # ─────────────────────────────────────── Capitaine : la cascade qui efface une équipe
    # 🔑 Le cas trouvé en review, et la raison du 2e code. `teams.captain_id` est en CASCADE :
    # sans ce refus, le départ du capitaine efface l'équipe, son roster, sa ligne `rankings`
    # (Elo, W/L, position au ladder) et l'identité de l'adversaire dans son historique, SANS
    # notifier personne. Et ce, même quand l'équipe n'est engagée dans RIEN — c'est le cas
    # majoritaire, et le plus destructeur.
    s.section("Un capitaine ne peut pas partir sans dissoudre son équipe (409 `captain_of_team`)")
    tokCap, idCap, _ = register("alice")
    tok1, id1, _ = register("bob")
    tok2, id2, _ = register("carol")
    for t in (tokCap, tok1, tok2):
        link(t, "riot")
    VAL2 = ladder_id(tokCap, "val", "2v2")

    _, b = req("POST", "/teams", tokCap, {"ladderId": VAL2, "name": "del" + uuid.uuid4().hex[:6]})
    team = (b.get("team") or b)["id"]
    join_team(team, id1)
    join_team(team, id2)

    st, b = delete_me(tokCap)
    s.check("capitaine d'une équipe (non engagée) → 409", st, 409, b.get("error", ""))
    s.check("… avec son PROPRE code (le remède n'est pas le même)", b.get("code"), "captain_of_team")
    s.check("l'équipe est toujours là", sql(f"select count(*) from teams where id='{team}';"), "1")
    # 3 et non 2 : `POST /teams` inscrit le capitaine dans `team_members` en plus des 2
    # membres semés. C'est ce que compte l'en-tête « Roster N/10 » côté front.
    s.check("le roster est intact", sql(f"select count(*) from team_members where team_id='{team}';"), "3")

    # Contrôle positif : un simple MEMBRE non aligné n'est bloqué par rien.
    st, _ = delete_me(tok2)
    s.check(
        "un membre non aligné et non capitaine → 200",
        st,
        200,
        "⚠️ si 409 : la garde bloque sur l'appartenance à l'équipe, pas sur le capitanat.",
    )

    # ─────────────────────────────────────── Le pendant : dissoudre une équipe engagée
    # Sans cette garde, le refus ci-dessus serait contournable en un appel : dissoudre puis
    # partir. Le camp passerait à `team_id = NULL` et le slot resterait acceptable par son id.
    s.section("On ne dissout pas une équipe engagée (409 `team_engaged_in_match`)")
    st, b = req(
        "POST",
        "/matches",
        tokCap,
        {"ladderId": VAL2, "scheduledAt": future(hours=5), "lineup": [idCap, id1]},
    )
    s.check("le capitaine ouvre un slot d'équipe", st, 201, b.get("error", ""))
    MT = b["match"]["id"]

    st, b = req("DELETE", f"/teams/{team}", tokCap)
    s.check("dissoudre une équipe engagée → 409", st, 409, b.get("error", ""))
    s.check("… code stable", b.get("code"), "team_engaged_in_match")
    s.check("le camp a toujours son équipe", sql(f"select count(*) from match_sides where match_id='{MT}' and team_id='{team}';"), "1")

    # Et le parcours complet, celui qu'on impose : annuler le match, dissoudre, partir.
    s.section("Le parcours imposé au capitaine : annuler → dissoudre → supprimer")
    st, _ = req("DELETE", f"/matches/{MT}", tokCap)
    s.check("annuler son slot → 200", st, 200)
    st, b = req("DELETE", f"/teams/{team}", tokCap)
    s.check("dissoudre l'équipe, une fois libre → 200", st, 200, b.get("error", ""))
    st, b = delete_me(tokCap)
    s.check(
        "supprimer son compte → 200",
        st,
        200,
        f"⚠️ si 409 : le parcours de sortie est un cul-de-sac. Reçu : {b}",
    )

    return s.report()


if __name__ == "__main__":
    run()
