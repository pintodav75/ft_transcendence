"""F-PLAYER (B1/B2) — GET /users/{pseudo} enrichi : classements et équipes.

La page publique d'un joueur montrait QUI il est et jamais SON NIVEAU, sur une plateforme
dont c'est tout le sujet. La route rend désormais, en plus du profil et de la relation
d'amitié, `rankings` (une ligne par ladder où il a une entrée) et `teams` (ses équipes).

Trois choses sont vérifiées ici, et la deuxième est la seule qui ait coûté du travail :

1. **La projection.** L'ancienne version faisait un `select()` nu sur `users` puis retirait
   cinq colonnes par déstructuration — donc `is_admin`, ajoutée après cette liste, partait
   dans le payload sans être déclarée au contrat. Une liste de ce qu'on RETIRE oublie par
   construction tout ce qui arrive après elle ; on vérifie donc le jeu de clés EXACT.

2. 🔑 **Le rang doit être IDENTIQUE à celui de `GET /ladders/{id}/rankings`.** La fiche
   joueur renvoie vers ce classement d'un seul clic : deux façons de calculer un rang y
   afficheraient « #3 » ici et « #4 » là, pour la même personne. Le back range donc avec
   exactement le même `ORDER BY` (`elo desc, wins desc, losses asc, id asc`), départages
   compris — et c'est précisément les DÉPARTAGES que ce fichier force en SQL : un
   `count(*) where elo > mon_elo`, l'implémentation naïve, donne le même rang à tous les ex
   æquo et reste vert sur des Elo distincts.

3. **`isCaptain` décrit le PROFIL CONSULTÉ, pas l'appelant** — l'inverse exact du champ
   homonyme de `GET /teams`. Les deux payloads ont la même forme ; servir l'un à la place de
   l'autre poserait la couronne sur la mauvaise tête sans qu'aucun type ne bronche. On lit
   donc le même profil depuis DEUX comptes différents : la valeur ne doit pas bouger.
"""

import uuid

from helpers import (
    Suite,
    join_team,
    ladder_id,
    link,
    register,
    req,
    sql,
    future,
)

# Le contrat déclare NEUF champs pour `PublicUser` — ni plus (fuite), ni moins (le front
# lirait `undefined` d'une valeur que TS jure être une string).
#
# ⚠️ `isAdmin` EN FAIT PARTIE, volontairement : il est déclaré `required` dans `openapi.yaml`
# et la fiche joueur en tire sa pastille « Admin ». Ce n'est pas un secret — l'autorisation
# relit `users.is_admin` en base à chaque appel d'arbitrage, donc le connaître ne permet rien.
# Cette liste l'omettait, et c'était le test qui avait raison AVANT que le contrat ne change.
PUBLIC_USER_KEYS = {
    "id",
    "pseudo",
    "displayName",
    "bio",
    "avatarUrl",
    "oauthProvider",
    "oauthId",
    "isAdmin",
    "createdAt",
}


def profile(token, pseudo):
    _, b = req("GET", f"/users/{pseudo}", token)
    return b


def play(tok_a, tok_b, ladder, hours):
    """Un match 1v1 joué jusqu'au bout — c'est la SEULE façon de créer une ligne `rankings`.

    Aucune ligne ne naît d'une inscription : c'est l'asymétrie qui rend l'état vide normal
    pour un compte neuf, et c'est aussi pourquoi une suite qui veut un classement doit
    d'abord jouer un match.
    """
    _, b = req("POST", "/matches", tok_a, {"ladderId": ladder, "scheduledAt": future(hours=hours)})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_b)
    # Le résultat n'est acceptable qu'après le coup d'envoi : reculer `scheduled_at` est la
    # seule opération de la fixture que l'API ne sait pas faire.
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{m}';")
    s0 = sql(f"select id from match_sides where match_id='{m}' and side_index=0;")
    req("POST", f"/matches/{m}/result", tok_a, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{m}/result", tok_b, {"winnerSideId": s0, "scoreSelf": 0, "scoreOpponent": 2})
    return m


def board_ranks(token, ladder):
    """`{pseudo: rang}` tel que la PAGE CLASSEMENT l'affiche — la référence de la section 2."""
    _, b = req("GET", f"/ladders/{ladder}/rankings", token)
    return {
        e["competitor"]["pseudo"]: e["rank"]
        for e in b["rankings"]
        if e["competitor"]["type"] == "user"
    }


def run():
    s = Suite("F-PLAYER — GET /users/{pseudo} : classements et équipes")

    tokA, idA, pA = register("alice")
    tokB, idB, pB = register("bob")
    tokC, idC, pC = register("carol")
    tokD, idD, pD = register("dave")
    # Le compte NEUF de la suite : il ne joue jamais et n'entre dans aucune équipe.
    tokE, idE, pE = register("erin")
    for t in (tokA, tokB, tokC, tokD):
        link(t, "chess_com")
    CHESS = ladder_id(tokA, "chess", "1v1")

    # ───────────────────────────────────────────────── 1. forme et projection
    s.section("Le payload : deux clés de plus, et RIEN de plus dans `user`")

    body = profile(tokA, pE)
    s.check("les 4 clés du payload", sorted(body.keys()), ["friendship", "rankings", "teams", "user"])
    s.check(
        "projection exacte de `user` (⚠️ `isAdmin` fuyait avant la projection explicite)",
        sorted(body["user"].keys()),
        sorted(PUBLIC_USER_KEYS),
    )

    # 🚨 L'état vide est le NORMAL d'un compte neuf, pas une anomalie : une ligne de
    # classement naît du premier résultat de match, jamais d'une inscription.
    s.check("compte neuf : `rankings` présent et vide", body["rankings"], [])
    s.check("compte neuf : `teams` présent et vide", body["teams"], [])

    # ───────────────────────────────────────────────── 2. les classements
    s.section("Les classements : une ligne par ladder, servie avec son rang")

    play(tokA, tokB, CHESS, hours=1)
    play(tokC, tokD, CHESS, hours=3)

    body = profile(tokB, pA)
    s.check("un match terminé → 1 ligne de classement", len(body["rankings"]), 1)
    line = body["rankings"][0] if body["rankings"] else {}
    s.check(
        "les 8 champs déclarés au contrat",
        sorted(line.keys()),
        ["elo", "gameId", "ladderId", "ladderName", "ladderSize", "losses", "rank", "wins"],
    )
    s.check("le ladder est bien celui joué", line.get("ladderId"), CHESS)
    s.check("le jeu est servi, pas déduit d'un nom", line.get("gameId"), "chess")
    s.check("le nom du ladder vient de la base", line.get("ladderName"), sql(f"select name from ladders where id='{CHESS}';"))
    s.check("vainqueur : 1 victoire", line.get("wins"), 1)
    s.check("vainqueur : 0 défaite", line.get("losses"), 0)
    # ⚠️ Un `bigint` (row_number, count) remonte en STRING via le driver pg. Sans le `::int`
    # du handler, `rank` vaudrait "1" — affiché correctement par coïncidence côté front, et
    # faux à la première comparaison numérique.
    s.check("`rank` est un ENTIER, pas la string d'un bigint", isinstance(line.get("rank"), int), True, f"reçu {line.get('rank')!r}")
    s.check("`ladderSize` aussi", isinstance(line.get("ladderSize"), int), True, f"reçu {line.get('ladderSize')!r}")
    s.check(
        "`ladderSize` = le nombre de classés du ladder",
        line.get("ladderSize"),
        int(sql(f"select count(*) from rankings where ladder_id='{CHESS}';")),
    )

    # 🔑 LE CŒUR DE LA SECTION. On force les quatre joueurs de test à des lignes STRICTEMENT
    # IDENTIQUES : le tri ne peut alors les départager que par `id`, le dernier critère. Une
    # implémentation naïve (`count(*) where elo > le mien`) leur donnerait à tous le MÊME
    # rang et resterait verte sur des Elo distincts — c'est ce cas-là qui la fait rougir.
    s.section("Le rang est celui du classement, ex æquo compris")
    ids = "','".join((idA, idB, idC, idD))
    sql(
        "update rankings set elo=1500, wins=5, losses=5 "
        f"where ladder_id='{CHESS}' and user_id in ('{ids}');"
    )

    ranks = board_ranks(tokA, CHESS)
    mine = {}
    for pseudo in (pA, pB, pC, pD):
        rows = profile(tokE, pseudo)["rankings"]
        mine[pseudo] = rows[0]["rank"] if rows else None

    s.check(
        "chaque fiche annonce le rang de la page classement",
        [mine[p] for p in (pA, pB, pC, pD)],
        [ranks.get(p) for p in (pA, pB, pC, pD)],
        "⚠️ si ça diverge : le back ne range plus avec l'ORDER BY de /ladders/{id}/rankings",
    )
    s.check(
        "… et quatre ex æquo reçoivent quatre rangs DISTINCTS",
        len(set(mine.values())),
        4,
        f"reçus : {sorted(mine.values())}",
    )

    # Le tri des lignes entre elles : le ladder joué le plus RÉCEMMENT en tête. Un Elo ne se
    # compare pas d'un ladder à l'autre, une date si.
    s.section("Plusieurs ladders : le plus récemment joué en tête")
    RL = ladder_id(tokA, "rl", "1v1")
    for t in (tokA, tokB):
        link(t, "epic")
    play(tokA, tokB, RL, hours=5)
    # Les deux lignes d'alice, datées à la main : chess VIEUX, rl RÉCENT.
    sql(f"update rankings set last_match_at = now() - interval '10 days' where user_id='{idA}' and ladder_id='{CHESS}';")
    sql(f"update rankings set last_match_at = now() where user_id='{idA}' and ladder_id='{RL}';")
    order = [r["ladderId"] for r in profile(tokE, pA)["rankings"]]
    s.check("deux ladders classés", len(order), 2)
    s.check("le plus récent d'abord", order, [RL, CHESS])

    # ───────────────────────────────────────────────── 3. les équipes
    s.section("Les équipes : `isCaptain` décrit le PROFIL, jamais l'appelant")

    VAL = ladder_id(tokA, "val", "5v5")
    # Deux équipes pour alice, nommées de façon à ce que le tri par nom soit VÉRIFIABLE :
    # sans tri explicite Postgres est libre de les rendre dans n'importe quel ordre.
    _, b = req("POST", "/teams", tokA, {"ladderId": VAL, "name": "zz-" + uuid.uuid4().hex[:6]})
    teamZ = b["team"]["id"]
    nameZ = b["team"]["name"]
    LOL = ladder_id(tokA, "lol", "5v5")
    _, b = req("POST", "/teams", tokA, {"ladderId": LOL, "name": "aa-" + uuid.uuid4().hex[:6]})
    teamA = b["team"]["id"]
    nameA = b["team"]["name"]
    # bob REJOINT l'équipe val d'alice : il en est membre, pas capitaine.
    join_team(teamZ, idB)

    alice_teams = profile(tokE, pA)["teams"]
    s.check("alice : 2 équipes", len(alice_teams), 2)
    # ⚠️ SEPT, pas six : `elo` est déclaré `required` dans `PlayerTeam` (nullable, une équipe
    # neuve n'a pas encore de ligne `rankings`) et la fiche joueur l'affiche sur chaque équipe.
    s.check(
        "les 7 champs déclarés au contrat",
        sorted(alice_teams[0].keys()) if alice_teams else [],
        ["elo", "gameId", "id", "isCaptain", "ladder", "logoUrl", "name"],
    )
    s.check("triées par nom", [t["name"] for t in alice_teams], [nameA, nameZ])
    s.check("le ladder est nommé, pas seulement identifié", alice_teams[0].get("ladder"), sql(f"select name from ladders where id='{LOL}';"))
    s.check("le jeu vient du ladder", {t["gameId"] for t in alice_teams}, {"lol", "val"})

    # 🚨 LE CHECK QUI ATTRAPE LA CONFUSION AVEC `TeamListItem`. Le même profil, lu par deux
    # comptes différents, doit rendre exactement la même chose : la couronne appartient au
    # profil consulté. Lue depuis `GET /teams`, elle suivrait l'APPELANT et basculerait.
    seen_by_bob = {t["id"]: t["isCaptain"] for t in profile(tokB, pA)["teams"]}
    seen_by_erin = {t["id"]: t["isCaptain"] for t in profile(tokE, pA)["teams"]}
    s.check("alice capitaine de ses 2 équipes, vue par bob", seen_by_bob, {teamZ: True, teamA: True})
    s.check("… et identique vue par un tiers", seen_by_erin, seen_by_bob)

    bob_teams = profile(tokA, pB)["teams"]
    s.check("bob : 1 équipe (celle qu'il a rejointe)", [t["id"] for t in bob_teams], [teamZ])
    s.check(
        "bob n'en est PAS capitaine, même lu par la capitaine",
        [t["isCaptain"] for t in bob_teams],
        [False],
        "⚠️ si True : le handler renvoie le `isCaptain` de GET /teams (l'appelant), pas celui du profil",
    )

    return s.report()


if __name__ == "__main__":
    run()
