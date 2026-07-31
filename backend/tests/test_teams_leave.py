"""BX-LEAVE — DELETE /teams/:id/members/:userId : un départ ne laisse pas de fantôme aligné.

Le bug d'origine : la route ne regardait **aucun match**. Elle refusait le départ du
capitaine, et c'est tout. Un joueur retiré du roster restait donc **aligné** dans les
créneaux `pending` de son ancienne équipe, avec deux dégâts :

  1. il pouvait rejoindre une AUTRE équipe du même ladder et **accepter le créneau de son
     ancienne équipe** — la garde anti-auto-acceptation compare les `team_id` des deux
     camps, pas les joueurs (`matches.ts`), donc rien ne l'arrêtait : il se retrouvait
     participant **des deux camps du même match** ;
  2. un créneau dont la lineup contient un non-membre pouvait être **joué tel quel** : la
     garde de composition n'est vérifiée qu'à la création et à l'acceptation de l'autre
     camp, jamais rétroactivement sur le camp créateur.

La règle livrée, en deux temps :

  * **match ACTIF** (`LOCKING_STATUSES`) qui aligne le partant **avec cette équipe** →
    **409 `engaged_in_match`**, le même code que `DELETE /users/me` (BX-DEL) ;
  * **créneau `pending`** → on n'empêche PAS le départ (refuser fabriquerait un cul-de-sac :
    seul le capitaine peut annuler un créneau, un simple membre n'aurait aucune action
    possible) : ses lignes `match_participants` partent et le match passe `cancelled`.

⚠️ Les DEUX chemins de la route sont couverts : départ volontaire **et** exclusion par le
capitaine. Et la règle de destinataires (invariant #2) est vérifiée en négatif : l'acteur
et le partant ne reçoivent RIEN.

⚠️ Le contrôle le plus important de la suite n'est pas un code HTTP mais le §2 : après le
départ, le nombre de camps du match où le partant est aligné doit être **0** — avant le
correctif il montait à **2**.
"""

import threading
import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req, sql


def create_team(tok_cap, ladder, tag):
    st, b = req("POST", "/teams", tok_cap, {"ladderId": ladder, "name": tag + uuid.uuid4().hex[:6]})
    team = b.get("team") or b
    return st, team.get("id")


# Tous les matchs ouverts par CETTE suite, pour qu'elle nettoie derrière elle (voir
# `purge_created()`). Liste d'ids EXPLICITES : jamais de `delete ... where status=...` nu,
# qui emporterait les données de démo posées à la main dans la base de dev.
CREATED_MATCHES = []


def open_slot(tok_cap, ladder, lineup, hours):
    """Ouvre un créneau d'ÉQUIPE. S'arrête net si la création échoue : sans l'id du match,
    tous les checks suivants mentiraient (ils compteraient 0 ligne et seraient verts)."""
    st, b = req("POST", "/matches", tok_cap, {"ladderId": ladder, "scheduledAt": future(hours), "lineup": lineup})
    if st != 201 or "match" not in b:
        raise SystemExit(f"open_slot: création refusée ({st}) -> {b}")
    CREATED_MATCHES.append(b["match"]["id"])
    return b["match"]["id"]


def purge_created():
    """Supprime les matchs ouverts par cette suite, par LISTE D'IDS EXPLICITE.

    ⚠️ Pourquoi `helpers.cleanup()` ne suffit pas ici, et c'est propre à ce ticket : il
    identifie les matchs de test par leurs lignes `match_participants` appartenant à un
    user de test. Or BX-LEAVE est la première fonctionnalité qui **supprime** des lignes de
    composition — un créneau annulé peut donc se retrouver sans aucun participant, et
    devenir INVISIBLE pour `cleanup()`, qui laisse alors la ligne `matches` (plus son
    `match_sides`) derrière lui à chaque run. Constaté : 3 orphelins par passage.

    On nettoie donc explicitement, dans l'ordre des FK, et **uniquement** les ids qu'on a
    créés soi-même.
    """
    if not CREATED_MATCHES:
        return
    ids = ",".join(f"'{m}'" for m in CREATED_MATCHES)
    sql(
        f"delete from notifications where (data->>'matchId') in ({ids});"
        f"delete from match_participants where match_side_id in "
        f"  (select id from match_sides where match_id in ({ids}));"
        f"update matches set winner_side_id = null where id in ({ids});"
        f"delete from match_sides where match_id in ({ids});"
        f"delete from matches where id in ({ids});"
    )


def status_of(m):
    return sql(f"select status from matches where id='{m}';")


def sides_aligning(m, uid):
    """Combien de CAMPS de ce match alignent ce joueur. 0 = nettoyé, 2 = le bug."""
    return sql(
        "select count(distinct s.id) from match_sides s "
        "join match_participants p on p.match_side_id = s.id "
        f"where s.match_id='{m}' and p.user_id='{uid}';"
    )


def lineup_size(m):
    return sql(
        "select count(*) from match_participants p "
        f"join match_sides s on s.id = p.match_side_id where s.match_id='{m}';"
    )


def is_member(team, uid):
    return sql(f"select count(*) from team_members where team_id='{team}' and user_id='{uid}';")


def notifs(uid, m):
    """Les `match_cancelled_member_left` reçues par cet user POUR ce match."""
    return sql(
        "select count(*) from notifications "
        f"where user_id='{uid}' and type='match_cancelled_member_left' and data->>'matchId'='{m}';"
    )


def notif_field(uid, m, field):
    return sql(
        f"select data->>'{field}' from notifications "
        f"where user_id='{uid}' and type='match_cancelled_member_left' and data->>'matchId'='{m}';"
    )


def leave(team, uid, token):
    return req("DELETE", f"/teams/{team}/members/{uid}", token)


def notifs_total(m):
    """TOUTES les notifs d'annulation émises pour ce match, destinataires confondus."""
    return sql(
        "select count(*) from notifications "
        f"where type='match_cancelled_member_left' and data->>'matchId'='{m}';"
    )


def race_leave(team, pair):
    """Deux départs lancés au MÊME instant, via `threading.Barrier`.

    ⚠️ Deux requêtes lancées « à la suite » démarrent en décalé et ne se croisent jamais :
    le test passerait alors que le bug est bien là (piège documenté du README). La barrière
    est ce qui rend la course réelle.
    """
    barrier = threading.Barrier(len(pair))
    out = {}

    def go(uid, token):
        barrier.wait()
        out[uid] = leave(team, uid, token)[0]

    threads = [threading.Thread(target=go, args=(uid, token)) for uid, token in pair]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def run():
    s = Suite("BX-LEAVE — DELETE /teams/:id/members/:userId (nettoyage de lineup)")

    # ── comptes ──────────────────────────────────────────────────────────────────────
    # ⚠️ Les tags sont contraints par cleanup() (alice|bob|carol|dave|erin) : on réutilise
    # les mêmes tags avec des suffixes hexa différents plutôt que d'en inventer.
    tokA, idA, pA = register("alice")  # capitaine ALPHA, présent dans plusieurs lineups
    tokB, idB, pB = register("bob")  # ALPHA, aligné §1, part de lui-même, fonde BRAVO
    tokC, idC, pC = register("carol")  # ALPHA, aligné §3
    tokD, idD, _ = register("dave")  # capitaine CHARLIE (l'adversaire qui accepte)
    tokE, idE, _ = register("erin")  # CHARLIE, 2e joueur
    tokE2, idE2, _ = register("erin")  # BRAVO, 2e joueur
    tokD2, idD2, _ = register("dave")  # ALPHA, sur le BANC (jamais aligné)
    tokB2, idB2, pB2 = register("bob")  # ALPHA, aligné §4, EXCLU par le capitaine
    tokC2, idC2, _ = register("carol")  # ALPHA, aligné §4, reste (témoin destinataire)
    tokD3, idD3, _ = register("dave")  # ALPHA, aligné §5 dans un match ACTIF
    tokC3, idC3, _ = register("carol")  # ALPHA, aligné §6 dans DEUX créneaux
    tokE3, idE3, _ = register("erin")  # ALPHA, aligné §6 dans un 3e créneau (témoin)

    VAL2 = ladder_id(tokA, "val", "2v2")  # lockoutMinutes = 30
    everyone = (tokA, tokB, tokC, tokD, tokE, tokE2, tokD2, tokB2, tokC2, tokD3, tokC3, tokE3)
    for t in everyone:
        link(t, "riot")

    st, ALPHA = create_team(tokA, VAL2, "ALPHA")
    s.check("équipe ALPHA créée -> 201", st, 201)
    st, CHARLIE = create_team(tokD, VAL2, "CHARLIE")
    s.check("équipe CHARLIE créée -> 201", st, 201)
    for uid in (idB, idC, idD2, idB2, idC2, idD3, idC3, idE3):
        join_team(ALPHA, uid)
    join_team(CHARLIE, idE)

    # ── §1 — départ VOLONTAIRE : le créneau pending tombe, la lineup est nettoyée ─────
    s.section("§1 — départ volontaire depuis un créneau `pending`")
    M1 = open_slot(tokA, VAL2, [idA, idB], 1)
    s.check("M1 est `pending` avant le départ", status_of(M1), "pending")
    s.check("M1 aligne bien 2 joueurs", lineup_size(M1), "2")

    st, _ = leave(ALPHA, idB, tokB)
    s.check("bob quitte ALPHA -> 200", st, 200)
    s.check("bob n'est plus membre d'ALPHA", is_member(ALPHA, idB), "0")
    s.check("M1 est passé `cancelled`", status_of(M1), "cancelled")
    s.check("bob n'est plus aligné dans M1", sides_aligning(M1, idB), "0")
    s.check("alice, elle, RESTE alignée (on ne retire que le partant)", sides_aligning(M1, idA), "1")

    # Destinataires : reste de la lineup + capitaine, jamais l'acteur. Ici alice est les
    # deux à la fois -> `notify()` dédoublonne, elle doit avoir UNE seule notif.
    s.check("alice (lineup + capitaine) reçoit 1 notif d'annulation", notifs(idA, M1), "1")
    s.check("bob (le partant) n'en reçoit AUCUNE", notifs(idB, M1), "0")
    s.check("la notif nomme le joueur qui part", notif_field(idA, M1, "playerPseudo"), pB)
    s.check("la notif porte l'équipe concernée", notif_field(idA, M1, "teamId"), ALPHA)

    # ── §2 — LE CŒUR DU TICKET : l'ancien créneau n'est plus acceptable ───────────────
    s.section("§2 — l'ex-coéquipier ne peut plus accepter le créneau de son ancienne équipe")
    st, BRAVO = create_team(tokB, VAL2, "BRAVO")
    s.check("bob peut fonder BRAVO sur le même ladder -> 201", st, 201)
    join_team(BRAVO, idE2)

    # ⚠️ Avant le correctif : 200. La garde anti-auto-acceptation compare `side0.teamId`
    # (ALPHA) à la team de l'accepteur (BRAVO) : elles diffèrent, elle laisse passer.
    st, b = req("POST", f"/matches/{M1}/accept", tokB, {"lineup": [idB, idE2]})
    s.check("bob ne peut plus accepter l'ancien créneau d'ALPHA -> 409", st, 409, str(b)[:90])
    s.check("bob n'est participant d'AUCUN camp de M1 (le bug en donnait 2)", sides_aligning(M1, idB), "0")
    s.check("M1 n'a pas été démarré par cette tentative", status_of(M1), "cancelled")

    # ── §3 — le BANC n'est pas concerné ──────────────────────────────────────────────
    s.section("§3 — un membre NON aligné part sans rien casser")
    M2 = open_slot(tokA, VAL2, [idA, idC], 2)
    st, _ = leave(ALPHA, idD2, tokD2)
    s.check("le remplaçant du banc quitte ALPHA -> 200", st, 200)
    s.check("M2 reste `pending` (il n'y était pas aligné)", status_of(M2), "pending")
    s.check("la lineup de M2 est intacte", lineup_size(M2), "2")
    s.check("personne n'a été notifié à tort", notifs(idA, M2), "0")

    # ── §4 — EXCLUSION par le capitaine : mêmes effets, destinataires différents ──────
    s.section("§4 — exclusion par le capitaine (le capitaine est l'ACTEUR)")
    # Le capitaine n'est PAS dans cette lineup : c'est ce qui rend la règle observable.
    # Destinataires attendus = {carol2} — le reste de la lineup. alice agit, bob2 part.
    M3 = open_slot(tokA, VAL2, [idB2, idC2], 3)
    st, _ = leave(ALPHA, idB2, tokA)
    s.check("le capitaine exclut bob2 -> 200", st, 200)
    s.check("M3 est passé `cancelled`", status_of(M3), "cancelled")
    s.check("bob2 n'est plus aligné dans M3", sides_aligning(M3, idB2), "0")
    s.check("carol2 (reste de la lineup) est notifiée", notifs(idC2, M3), "1")
    s.check("alice (l'ACTEUR) n'est pas notifiée", notifs(idA, M3), "0")
    s.check("bob2 (l'exclu) n'est pas notifié de l'annulation", notifs(idB2, M3), "0")
    s.check(
        "bob2 reçoit bien, lui, son `team_member_removed`",
        sql(f"select count(*) from notifications where user_id='{idB2}' and type='team_member_removed';"),
        "1",
    )

    # ── §5 — match ACTIF : refus 409, et RIEN n'est écrit ────────────────────────────
    s.section("§5 — un match actif refuse le départ (409 engaged_in_match)")
    M4 = open_slot(tokA, VAL2, [idA, idD3], 5)
    st, _ = req("POST", f"/matches/{M4}/accept", tokD, {"lineup": [idD, idE]})
    s.check("CHARLIE accepte M4 -> 200", st, 200)
    s.check("M4 est `in_progress`", status_of(M4), "in_progress")

    st, b = leave(ALPHA, idD3, tokD3)
    s.check("dave3 ne peut pas quitter ALPHA -> 409", st, 409)
    s.check("… avec le code de BX-DEL", b.get("code") if isinstance(b, dict) else None, "engaged_in_match")
    st, b = leave(ALPHA, idD3, tokA)
    s.check("le capitaine ne peut pas l'exclure non plus -> 409", st, 409)
    s.check("… même code", b.get("code") if isinstance(b, dict) else None, "engaged_in_match")
    s.check("dave3 est toujours membre (rien n'a été écrit)", is_member(ALPHA, idD3), "1")
    s.check("M4 n'a pas été annulé", status_of(M4), "in_progress")

    # Contrôle POSITIF a : un membre non aligné part malgré le match actif de l'équipe.
    join_team(ALPHA, idD2)  # le banc revient
    st, _ = leave(ALPHA, idD2, tokD2)
    s.check("un membre NON aligné part malgré le match actif -> 200", st, 200)

    # Idempotence : un ex-membre encore aligné dans un match ACTIF (l'état hérité que ce
    # ticket corrige) ne doit pas transformer le 200 idempotent en 409. La garde ne
    # s'applique qu'à quelqu'un qui a réellement une place à quitter.
    sql(f"delete from team_members where team_id='{ALPHA}' and user_id='{idD3}';")
    st, _ = leave(ALPHA, idD3, tokA)
    s.check("retirer un NON-membre reste idempotent -> 200", st, 200)
    s.check("… et n'annule pas le match actif", status_of(M4), "in_progress")

    # Contrôle POSITIF b : un match TERMINÉ ne bloque plus, et son historique est intact.
    join_team(ALPHA, idD3)
    sql(f"update matches set status='completed' where id='{M4}';")
    st, _ = leave(ALPHA, idD3, tokD3)
    s.check("un match `completed` ne bloque plus le départ -> 200", st, 200)
    s.check("M4 reste `completed` (on ne réécrit pas l'histoire)", status_of(M4), "completed")
    s.check("dave3 reste dans la compo du match terminé", sides_aligning(M4, idD3), "1")

    # ── §6 — plusieurs créneaux : seuls ceux du partant tombent ──────────────────────
    s.section("§6 — un joueur aligné sur plusieurs créneaux les emporte tous, et eux seuls")
    M6 = open_slot(tokA, VAL2, [idA, idC3], 6)
    M7 = open_slot(tokA, VAL2, [idA, idC3], 7)
    M8 = open_slot(tokA, VAL2, [idA, idE3], 8)
    st, _ = leave(ALPHA, idC3, tokC3)
    s.check("carol3 quitte ALPHA -> 200", st, 200)
    s.check("M6 annulé", status_of(M6), "cancelled")
    s.check("M7 annulé", status_of(M7), "cancelled")
    s.check("M8 (où elle n'était pas alignée) reste `pending`", status_of(M8), "pending")
    s.check("alice notifiée pour M6", notifs(idA, M6), "1")
    s.check("alice notifiée pour M7", notifs(idA, M7), "1")
    s.check("aucune notif pour M8", notifs(idA, M8), "0")

    # ── §7 — COURSE : deux départs simultanés du MÊME créneau ────────────────────────
    # Le critère de la carte : « deux départs simultanés ne doivent ni annuler deux fois
    # ni notifier deux fois ». C'est ce que garantit le verrou consultatif `team:<id>` —
    # les deux transactions le demandent, donc elles s'exécutent l'une après l'autre, et la
    # seconde relit un créneau qui n'est plus `pending`.
    #
    # Le compte attendu, quel que soit l'ordre gagné : le PREMIER partant notifie
    # {l'autre joueur aligné, le capitaine} = 2 notifs, le SECOND n'en émet aucune.
    # Le capitaine (hors composition ici) doit donc en avoir exactement UNE.
    s.section("§7 — course : deux départs simultanés n'annulent ni ne notifient deux fois")
    for i, hour in enumerate((10, 11, 12), start=1):
        tokX, idX, _ = register("bob")
        tokY, idY, _ = register("carol")
        link(tokX, "riot")
        link(tokY, "riot")
        join_team(ALPHA, idX)
        join_team(ALPHA, idY)
        MR = open_slot(tokA, VAL2, [idX, idY], hour)

        codes = race_leave(ALPHA, [(idX, tokX), (idY, tokY)])
        s.check(f"course {i} — les deux départs sont acceptés", sorted(codes.values()), [200, 200])
        s.check(f"course {i} — le créneau est annulé", status_of(MR), "cancelled")
        s.check(f"course {i} — le capitaine reçoit UNE seule notif", notifs(idA, MR), "1")
        s.check(f"course {i} — 2 notifs au total, jamais 4", notifs_total(MR), "2")
        s.check(f"course {i} — plus aucun des deux n'est membre",
                sql(f"select count(*) from team_members where team_id='{ALPHA}' "
                    f"and user_id in ('{idX}','{idY}');"), "0")

    # ── §8 — COURSE : création d'un créneau PENDANT le départ ────────────────────────
    # ⚠️ C'est CETTE course qui justifie le verrou `team:<id>`, pas la précédente (§7 est
    # déjà tenue par l'UPDATE conditionnel). Sans verrou, les deux transactions se
    # regardent dans le blanc des yeux :
    #   * `POST /matches` lit le roster et voit le partant ENCORE membre (notre DELETE
    #     n'est pas commité) → il l'aligne ;
    #   * on scanne les créneaux `pending` et on ne voit pas le sien (son INSERT n'est pas
    #     commité) → on n'annule rien ;
    #   → les deux commitent et un créneau TOUT NEUF aligne un non-membre : le défaut même
    #     que ce ticket corrige, réintroduit par la fenêtre.
    #
    # L'invariant testé ne présume RIEN de l'ordre gagnant — les deux issues sont légitimes
    # (créneau créé puis annulé, ou création refusée faute de roster) : on vérifie seulement
    # qu'il ne reste AUCUN créneau `pending` d'ALPHA alignant le partant.
    s.section("§8 — course : ouvrir un créneau pendant que le joueur aligné s'en va")
    for i, hour in enumerate((13, 14, 15), start=1):
        tokZ, idZ, _ = register("erin")
        link(tokZ, "riot")
        join_team(ALPHA, idZ)

        barrier = threading.Barrier(2)
        results = {}

        def create():
            barrier.wait()
            results["create"] = req(
                "POST", "/matches", tokA,
                {"ladderId": VAL2, "scheduledAt": future(hour), "lineup": [idA, idZ]},
            )[0]

        def quit_team():
            barrier.wait()
            results["leave"] = leave(ALPHA, idZ, tokZ)[0]

        threads = [threading.Thread(target=create), threading.Thread(target=quit_team)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        ghost = sql(
            "select count(*) from matches m "
            "join match_sides s on s.match_id = m.id "
            "join match_participants p on p.match_side_id = s.id "
            f"where m.status='pending' and s.team_id='{ALPHA}' and p.user_id='{idZ}';"
        )
        s.check(
            f"course {i} — aucun créneau `pending` n'aligne le partant",
            ghost, "0",
            f"(create={results.get('create')}, leave={results.get('leave')})",
        )
        s.check(f"course {i} — le départ a bien abouti", results.get("leave"), 200)

    # Dans `run()` et pas seulement sous `__main__` : c'est la seule façon que le nettoyage
    # ait lieu AUSSI quand la suite est jouée par `run_all.py`.
    purge_created()
    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        ok, ko = run()
    finally:
        cleanup()
    raise SystemExit(1 if ko else 0)
