"""B5c (review) — courses concurrentes + fuite d'autorisation sur DELETE.

Défauts trouvés en review, TOUS reproduits avant correction :

  1. COURSE — le même camp acceptait DEUX matchs différents en même temps.
     L'update conditionnel (`WHERE status='pending'`) ne sérialise que deux accepteurs
     sur LE MÊME match : sur deux matchs distincts, les UPDATE visent des lignes
     différentes → les deux passaient → 2 matchs `in_progress` → lockout §5.2 contourné.
     Idem à la CRÉATION (2 slots ouverts).
     → Fermé par un VERROU transactionnel sur l'identité du camp + re-lecture du
       lockout DANS la transaction.

  2. INTERBLOCAGE — acceptation CROISÉE : alice prend le slot de bob pendant que bob
     prend celui d'alice. Chaque transaction ne verrouillait que SON accepteur (clés
     différentes → aucune sérialisation), puis chacune verrouillait la ligne du match
     qu'elle démarre et réclamait celle de l'autre (l'annulation « option A » touche
     les slots des DEUX camps) → T1 tient B et veut A, T2 tient A et veut B.
     Postgres tue une transaction → **500 sur un conflit métier normal**.
     → Fermé en verrouillant les DEUX camps dans un ORDRE DÉTERMINISTE (clés triées) :
       les deux transactions réclament les mêmes verrous dans le même ordre, donc l'une
       attend au lieu de se mordre la queue. Remède canonique au deadlock.

  3. FUITE — `DELETE /matches/:id` répondait 200 (annulé) ou 409 (en cours) AVANT de
     vérifier qui appelle → un inconnu obtenait un ORACLE sur l'état de n'importe quel
     match (404 = inexistant, 200 = annulé, 409 = en cours), contournant le 403 qui
     protège l'anonymat des slots. Fermé en mettant l'autorisation AVANT le statut.

⚠️ Ces tests sont des NON-RÉGRESSIONS : ils échouaient avant les correctifs.

⚠️⚠️ Les courses utilisent une **BARRIÈRE** (`threading.Barrier`) pour que les requêtes
partent au même instant. Sans elle, les threads démarrent en décalé, ne se croisent
jamais, et le test PASSE alors que le bug est bien là — un faux négatif, pire qu'aucun
test. C'est exactement ce qui a masqué l'interblocage au premier essai.
"""

import threading
import uuid

from helpers import Suite, future, ladder_id, link, register, req, sql


def active_matches(user_id):
    return sql(
        "select count(*) from matches m "
        "join match_sides s on s.match_id = m.id "
        "join match_participants p on p.match_side_id = s.id "
        f"where p.user_id = '{user_id}' and m.status = 'in_progress';"
    )


def fire(results, tag, method, path, token, body=None, gate=None):
    # ⚠️ La BARRIÈRE est essentielle sur les tests de course : sans elle, les threads
    # partent en décalé et ne se croisent jamais → le test PASSE alors que le bug existe.
    # (C'est exactement ce qui m'est arrivé sur l'interblocage : faux négatif.)
    if gate:
        gate.wait()
    results[tag] = req(method, path, token, body)


def run():
    s = Suite("B5c (review) — concurrence & fuite d'autorisation")

    tokA, idA, _ = register("alice")
    tokB, idB, _ = register("bob")
    tokC, idC, _ = register("carol")
    tokE, idE, _ = register("erin")
    # dave ne crée ni n'accepte JAMAIS rien : c'est notre étranger de référence.
    tokD, idD, _ = register("dave")

    CHESS = ladder_id(tokA, "chess", "1v1")
    for t in (tokA, tokB, tokC, tokD, tokE):
        link(t, "chess_com")

    # ───────────────────────────── 0. ACCEPTATION CROISÉE (interblocage Postgres)
    s.section("Course — acceptation CROISÉE (alice prend le slot de bob, bob celui d'alice)")

    ours0 = "','".join([idA, idB])
    mine0 = (
        "id in (select s.match_id from match_sides s "
        " join match_participants p on p.match_side_id = s.id "
        f" where p.user_id in ('{ours0}'))"
    )

    # Un interblocage est une COURSE : on répète pour ne pas conclure sur un coup de chance.
    # Avant le correctif (verrous non ordonnés), c'était 500 à TOUS les rounds.
    seen = []
    for _ in range(3):
        sql(f"update matches set status='completed' where status='in_progress' and {mine0};")
        sql(f"update matches set status='cancelled' where status='pending' and {mine0};")

        _, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
        SLOT_A = b["match"]["id"]
        _, b = req("POST", "/matches", tokB, {"ladderId": CHESS, "scheduledAt": future()})
        SLOT_B = b["match"]["id"]

        # Chacun accepte le slot de l'autre, au MÊME instant (barrière).
        # Sans ORDRE sur les verrous : T1 tient la ligne B et veut A, T2 tient A et veut B
        # (l'annulation « option A » touche les slots des DEUX camps) → interblocage, que
        # Postgres résout en tuant une transaction → 500 sur un conflit métier normal.
        gate = threading.Barrier(2)
        res = {}
        threads = [
            threading.Thread(target=fire, args=(res, "A→B", "POST", f"/matches/{SLOT_B}/accept", tokA, None, gate)),
            threading.Thread(target=fire, args=(res, "B→A", "POST", f"/matches/{SLOT_A}/accept", tokB, None, gate)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        seen.append(sorted([res["A→B"][0], res["B→A"][0]]))

    s.check("aucun 500 sur 3 rounds (plus d'interblocage)", [c for c in seen if 500 in c], [])
    s.check("chaque round : un accept passe, l'autre est refusé proprement", seen, [[200, 409]] * 3)
    s.check("alice n'a qu'UN match actif", active_matches(idA), "1")
    s.check("bob n'a qu'UN match actif", active_matches(idB), "1")

    # on repart propre pour la suite
    sql(f"update matches set status='completed' where status='in_progress' and {mine0};")
    sql(f"update matches set status='cancelled' where status='pending' and {mine0};")

    # ───────────────────────────── 1. même accepteur, DEUX matchs
    s.section("Course — le MÊME joueur accepte DEUX matchs distincts en parallèle")

    _, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M1 = b["match"]["id"]
    _, b = req("POST", "/matches", tokC, {"ladderId": CHESS, "scheduledAt": future()})
    M2 = b["match"]["id"]

    gate = threading.Barrier(2)
    res = {}
    threads = [
        threading.Thread(target=fire, args=(res, "M1", "POST", f"/matches/{M1}/accept", tokB, None, gate)),
        threading.Thread(target=fire, args=(res, "M2", "POST", f"/matches/{M2}/accept", tokB, None, gate)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    codes = sorted([res["M1"][0], res["M2"][0]])
    s.check("un seul accept passe (200 + 409)", codes, [200, 409])
    s.check("bob n'a qu'UN match actif (lockout §5.2 tenu)", active_matches(idB), "1")
    s.check(
        "le refusé cite bien le lockout",
        "locked out" in (res["M1"][1] if res["M1"][0] == 409 else res["M2"][1]).get("error", ""),
        True,
    )

    # ───────────────────────────── 2. deux accepteurs, MÊME match
    s.section("Course — DEUX joueurs acceptent LE MÊME match en parallèle")

    # On repart d'une ardoise propre pour nos 4 joueurs :
    #  - leur match actif les VERROUILLE (§5.2 fonctionne, c'est justement ce qu'on vient
    #    de prouver) → on le passe `completed`, ce qui libère le lockout ;
    #  - le slot du créateur non retenu est resté `pending` → il l'empêcherait d'en rouvrir
    #    un (« un seul slot ouvert ») → on l'annule.
    # ⚠️ On ne touche QUE les matchs de nos users de test.
    ours = "','".join([idA, idB, idC, idE])
    mine = (
        "id in (select s.match_id from match_sides s "
        " join match_participants p on p.match_side_id = s.id "
        f" where p.user_id in ('{ours}'))"
    )
    sql(f"update matches set status='completed' where status='in_progress' and {mine};")
    sql(f"update matches set status='cancelled' where status='pending' and {mine};")

    _, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": future()})
    M3 = b["match"]["id"]

    gate = threading.Barrier(2)
    res = {}
    threads = [
        threading.Thread(target=fire, args=(res, "B", "POST", f"/matches/{M3}/accept", tokB, None, gate)),
        threading.Thread(target=fire, args=(res, "C", "POST", f"/matches/{M3}/accept", tokC, None, gate)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    codes = sorted([res["B"][0], res["C"][0]])
    s.check("un seul accept passe (200 + 409)", codes, [200, 409])
    s.check(
        "le match n'a qu'UN side 1 (pas deux adversaires)",
        sql(f"select count(*) from match_sides where match_id='{M3}' and side_index=1;"),
        "1",
    )

    # ───────────────────────────── 3. deux CRÉATIONS simultanées (dette B5b, fermée ici)
    s.section("Course — le MÊME joueur ouvre DEUX slots en parallèle")

    gate = threading.Barrier(2)
    res = {}
    body = {"ladderId": CHESS, "scheduledAt": future()}
    threads = [
        threading.Thread(target=fire, args=(res, "a", "POST", "/matches", tokE, body, gate)),
        threading.Thread(target=fire, args=(res, "b", "POST", "/matches", tokE, body, gate)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    codes = sorted([res["a"][0], res["b"][0]])
    s.check("une seule création passe (201 + 409)", codes, [201, 409])
    s.check(
        "erin n'a qu'UN slot ouvert (invariant « un seul » tenu)",
        sql(
            "select count(*) from matches m "
            "join match_sides s on s.match_id = m.id "
            "join match_participants p on p.match_side_id = s.id "
            f"where p.user_id = '{idE}' and m.status = 'pending';"
        ),
        "1",
    )

    # ───────────────────────────── 4. DELETE : l'autorisation AVANT le statut
    # M3 est maintenant `in_progress` (alice + bob ou carol). Dave n'y est pour rien.
    s.section("Fuite — DELETE ne doit rien révéler à un inconnu")

    # a) match ANNULÉ par son créateur → un étranger ≠ 200.
    #    On réutilise le slot qu'erin vient d'ouvrir (celui des deux créations qui a gagné) :
    #    elle en a exactement un, elle ne peut pas en rouvrir un second.
    won = res["a"][1] if res["a"][0] == 201 else res["b"][1]
    M4 = won["match"]["id"]
    st, _ = req("DELETE", f"/matches/{M4}", tokE)
    s.check("le créateur annule → 200", st, 200)
    s.check("le créateur ré-annule → 200 (idempotent)", req("DELETE", f"/matches/{M4}", tokE)[0], 200)

    st, b = req("DELETE", f"/matches/{M4}", tokD)
    s.check("un ÉTRANGER sur un match annulé → 403 (et non 200)", st, 403, b.get("error", ""))

    # b) match EN COURS → un étranger ne doit PAS recevoir 409 (ça révèle l'état)
    st, b = req("DELETE", f"/matches/{M3}", tokD)
    s.check("un ÉTRANGER sur un match in_progress → 403 (et non 409)", st, 403, b.get("error", ""))

    # c) le créateur, lui, doit toujours obtenir 409 sur un match démarré
    st, b = req("DELETE", f"/matches/{M3}", tokA)
    s.check("le CRÉATEUR sur son match in_progress → 409 (pas 403)", st, 409, b.get("error", ""))

    # d) un inconnu ne distingue plus « annulé » de « en cours » : 403 dans les deux cas
    s.check(
        "l'étranger reçoit le MÊME code quel que soit l'état → plus d'oracle",
        req("DELETE", f"/matches/{M4}", tokD)[0] == req("DELETE", f"/matches/{M3}", tokD)[0],
        True,
    )

    # e) un match inexistant reste un 404 (pas d'autorisation à vérifier)
    st, _ = req("DELETE", f"/matches/{uuid.uuid4()}", tokD)
    s.check("match inexistant → 404", st, 404)

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
