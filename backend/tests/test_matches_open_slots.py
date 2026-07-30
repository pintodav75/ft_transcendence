"""B-MM — GET /matches : le balayage des créneaux ouverts et le verdict `canAccept`.

Ce que le ticket a changé, et que cette suite doit prouver :

  1. `ladderId` DEVIENT OPTIONNEL — sans lui la route balaie tous les ladders. C'est ce
     qui rend une page « Matchmaking » possible : l'utilisateur parcourt des créneaux
     avant d'avoir choisi un ladder. Avec `ladderId`, le contrat d'origine ne bouge pas
     (404 sur un ladder inconnu compris).

  2. ENRICHISSEMENT — chaque créneau porte désormais le nom du ladder et du jeu, par
     JOINTURE : le front rend une ligne sans requête supplémentaire.
     ⚠️ L'ANONYMAT EST CONSERVÉ (décision B5b) : toujours ni team créatrice, ni maps.

  3. `canAccept` + `reason` — LE point du ticket. Sans lui le front afficherait un bouton
     que l'API refuserait, donc une ligne rouge dans la console Chrome (motif de rejet du
     projet). Les 5 codes de l'enum fermé sont couverts un par un.

  🔑 4. LE VERDICT DOIT ÊTRE VRAI. C'est la seule propriété qui compte vraiment, et c'est
     la raison d'être de cette suite : pour CHAQUE cas, on ne se contente pas de lire
     `canAccept`, on APPELLE `POST /matches/:id/accept` derrière et on vérifie que l'API
     dit la même chose. Un `canAccept` faux est pire que pas de champ du tout — c'est
     précisément le bug que ce champ existe pour empêcher. Les 5 refus sont donc des CAS
     NÉGATIFS reproduits pour de vrai (accept qui échoue), et chacun a son contrôle
     POSITIF (accept qui réussit) — sans quoi un `canAccept` câblé à `False` passerait
     tous les tests de refus.

  5. EXCLUSIONS — mes propres créneaux (par ÉQUIPE en 2v2+, par JOUEUR en 1v1) et les
     créneaux PÉRIMÉS, désormais sur le balayage multi-ladders et plus seulement par
     ladder.

  6. TRI — `scheduledAt` croissant, départagé par `createdAt`. La route ne triait pas
     du tout auparavant.

  7. FILTRES — `gameId`, `format`, `acceptable`, `limit`, et leurs refus (400).

⚠️ La base de dev contient les créneaux de `seed-dev` : aucune assertion ne porte sur la
TAILLE de la liste, seulement sur la présence/absence des créneaux que la suite a créés
et sur des propriétés vraies de TOUTES les lignes rendues.
"""

import uuid
from datetime import datetime, timedelta, timezone

from helpers import Suite, join_team, ladder_id, link, register, req, sql


def slot_at(hours):
    """Une heure de match valide : alignée sur le quart, `hours` dans le futur."""
    t = datetime.now(timezone.utc) + timedelta(hours=hours)
    t = t.replace(second=0, microsecond=0)
    t += timedelta(minutes=(15 - t.minute % 15) % 15)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def listing(token, qs=""):
    """La liste des créneaux, et l'index id → créneau pour les recherches ciblées."""
    st, b = req("GET", f"/matches{qs}", token)
    slots = b.get("slots", []) if isinstance(b, dict) else []
    return st, slots, {s["id"]: s for s in slots}


def run():
    s = Suite("B-MM — GET /matches (créneaux ouverts + verdict canAccept)")

    tokA, idA, pA = register("alice")  # capitaine team ALPHA (val 2v2) + joueur solo chess
    tokB, idB, pB = register("bob")  # membre d'ALPHA + joueur solo chess
    tokC, idC, pC = register("carol")  # AUCUNE team, AUCUN compte lié : les 2 refus §5.1
    tokD, idD, pD = register("dave")  # membre de BETA, PAS capitaine
    tokE, idE, pE = register("erin")  # capitaine team BETA (val 2v2)

    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")

    link(tokA, "chess_com")
    link(tokB, "chess_com")
    link(tokA, "riot")
    link(tokB, "riot")
    link(tokE, "riot")
    # ⚠️ carol ne lie RIEN, dave ne lie pas riot (encore) : ce sont eux les cas §5.1.

    # ─────────────────────────────────────────── 1. CONTRAT PRÉSERVÉ
    s.section("Le contrat d'origine ne bouge pas")

    st, _ = req("GET", "/matches")
    s.check("anonyme → 401 (jamais 400 : Zod passe APRÈS authenticate)", st, 401)

    st, b = req("GET", f"/matches?ladderId={uuid.uuid4()}", tokA)
    s.check("ladderId inconnu mais bien formé → 404", st, 404, b.get("error", ""))

    st, _ = req("GET", "/matches?ladderId=pas-un-uuid", tokA)
    s.check("ladderId malformé → 400", st, 400)

    st, _, _ = listing(tokA, f"?ladderId={CHESS}")
    s.check("ladderId valide → 200 (mode d'origine)", st, 200)

    # ─────────────────────────────────────────── 2. SOLO 1v1 : account_not_linked
    s.section("SOLO chess 1v1 — le créneau, son enrichissement, son anonymat")

    T1 = slot_at(2)
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T1})
    s.check("alice ouvre un créneau chess → 201", st, 201, b.get("error", ""))
    S1 = b.get("match", {}).get("id")

    st, slots, by_id = listing(tokB, "")
    s.check("BALAYAGE GLOBAL sans ladderId → 200", st, 200)
    s.check("le créneau d'alice y apparaît", S1 in by_id, True)

    row = by_id.get(S1, {})
    # Noms LUS EN BASE, jamais recopiés dans le test : un test qui réaffirme la constante
    # qu'il vérifie ne garde rien.
    want_ladder = sql(f"select name from ladders where id = '{CHESS}';")
    want_game = sql("select g.name from games g join ladders l on l.game_id = g.id "
                    f"where l.id = '{CHESS}';")
    s.check("enrichi : ladderName vient de la jointure", row.get("ladderName"), want_ladder)
    s.check("enrichi : gameName vient de la jointure", row.get("gameName"), want_game)
    s.check("enrichi : ladderId est rendu (routage front)", row.get("ladderId"), CHESS)
    s.check("les champs d'origine ne bougent pas : format", row.get("format"), "1v1")
    s.check("les champs d'origine ne bougent pas : gameId", row.get("gameId"), "chess")
    s.check("les champs d'origine ne bougent pas : scheduledAt", row.get("scheduledAt"), T1)
    # ANONYMAT (décision B5b) : on accepte sans savoir qui a ouvert. Liste NOIRE, donc
    # toujours vraie quels que soient les champs ajoutés demain.
    leaked = sorted(k for k in row if k in ("maps", "team", "teamId", "createdBy", "lineup"))
    s.check("🔑 anonymat conservé : ni créateur ni maps", leaked, [])

    s.check("bob (chess_com lié, libre) → canAccept", row.get("canAccept"), True)
    s.check("… et donc reason null", row.get("reason"), None)

    # CAS NÉGATIF §5.1 solo — carol n'a aucun compte lié.
    _, _, by_c = listing(tokC, "")
    s.check("carol (aucun compte lié) → canAccept False", by_c.get(S1, {}).get("canAccept"), False)
    s.check("… reason = account_not_linked", by_c.get(S1, {}).get("reason"), "account_not_linked")
    # 🔑 Et l'API dit-elle la même chose ? Sans ce contrôle, le champ n'engage à rien.
    st, b = req("POST", f"/matches/{S1}/accept", tokC)
    s.check("🔑 l'API confirme le refus (accept → 400)", st, 400, b.get("error", ""))

    # EXCLUSION — alice ne voit pas son propre créneau (identité = le JOUEUR en 1v1).
    _, _, by_a = listing(tokA, "")
    s.check("alice ne voit PAS son propre créneau", S1 in by_a, False)

    # ─────────────────────────────────────────── 3. SOLO : schedule_conflict
    s.section("§5.2 — schedule_conflict (fenêtres qui se chevauchent)")

    # On occupe bob à la MÊME heure que le créneau d'alice : il ouvre son propre créneau
    # à T1, carol… non, carol n'est pas liée. C'est BOB qui ouvre, et un tiers accepte.
    # Il faut un 3e joueur lié : on lie carol maintenant que son cas §5.1 est prouvé.
    link(tokC, "chess_com")
    st, b = req("POST", "/matches", tokB, {"ladderId": CHESS, "scheduledAt": T1})
    s.check("bob ouvre un créneau à la même heure → 201", st, 201, b.get("error", ""))
    S2 = b.get("match", {}).get("id")
    st, b = req("POST", f"/matches/{S2}/accept", tokC)
    s.check("carol l'accepte → bob a un match ACTIF à cette heure", st, 200, b.get("error", ""))

    _, _, by_b = listing(tokB, "")
    s.check("bob voit toujours le créneau d'alice", S1 in by_b, True)
    s.check("… mais canAccept est retombé à False", by_b.get(S1, {}).get("canAccept"), False)
    s.check("… reason = schedule_conflict", by_b.get(S1, {}).get("reason"), "schedule_conflict")
    st, b = req("POST", f"/matches/{S1}/accept", tokB)
    s.check("🔑 l'API confirme le refus (accept → 409)", st, 409, b.get("error", ""))

    # CONTRÔLE POSITIF — un créneau LOIN de son match : bob doit pouvoir l'accepter.
    # Sans lui, un `canAccept` câblé à False passerait tous les refus ci-dessus.
    T3 = slot_at(8)
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T3})
    s.check("alice ouvre un créneau bien plus tard → 201", st, 201, b.get("error", ""))
    S3 = b.get("match", {}).get("id")
    _, _, by_b = listing(tokB, "")
    s.check("bob : hors de sa fenêtre → canAccept True", by_b.get(S3, {}).get("canAccept"), True)
    st, b = req("POST", f"/matches/{S3}/accept", tokB)
    s.check("🔑 CONTRÔLE POSITIF : l'API accepte bien (200)", st, 200, b.get("error", ""))

    # ─────────────────────────────────────────── 4. TEAM 2v2 : les 3 codes d'équipe
    s.section("TEAM val 2v2 — no_team, not_captain, roster_not_linked")

    st, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "MMA" + uuid.uuid4().hex[:5]})
    ALPHA = (b.get("team") or b).get("id")
    s.check("team ALPHA créée (capitaine alice) → 201", st, 201, b.get("error", ""))
    join_team(ALPHA, idB)

    st, b = req("POST", "/teams", tokE, {"ladderId": VAL2, "name": "MMB" + uuid.uuid4().hex[:5]})
    BETA = (b.get("team") or b).get("id")
    s.check("team BETA créée (capitaine erin) → 201", st, 201, b.get("error", ""))
    join_team(BETA, idD)

    T4 = slot_at(3)
    st, b = req(
        "POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": T4, "lineup": [idA, idB]}
    )
    s.check("ALPHA ouvre un créneau 2v2 → 201", st, 201, b.get("error", ""))
    TS = b.get("match", {}).get("id")

    # EXCLUSION par ÉQUIPE — et pas seulement pour le capitaine : bob est un simple
    # membre d'ALPHA, le créneau de SON équipe doit disparaître de sa liste aussi.
    _, _, by_a = listing(tokA, "")
    s.check("alice (capitaine ALPHA) ne voit pas le créneau d'ALPHA", TS in by_a, False)
    _, _, by_b = listing(tokB, "")
    s.check("bob (simple membre d'ALPHA) non plus", TS in by_b, False)

    # CAS NÉGATIF — carol n'a aucune équipe sur ce ladder.
    _, _, by_c = listing(tokC, "")
    s.check("carol : canAccept False", by_c.get(TS, {}).get("canAccept"), False)
    s.check("… reason = no_team", by_c.get(TS, {}).get("reason"), "no_team")
    st, b = req("POST", f"/matches/{TS}/accept", tokC, {"lineup": [idC, idC]})
    s.check("🔑 l'API confirme (accept → 400)", st, 400, b.get("error", ""))

    # CAS NÉGATIF — dave est dans BETA mais n'en est pas capitaine.
    _, _, by_d = listing(tokD, "")
    s.check("dave : canAccept False", by_d.get(TS, {}).get("canAccept"), False)
    s.check("… reason = not_captain", by_d.get(TS, {}).get("reason"), "not_captain")
    st, b = req("POST", f"/matches/{TS}/accept", tokD, {"lineup": [idE, idD]})
    s.check("🔑 l'API confirme (accept → 403)", st, 403, b.get("error", ""))

    # CAS NÉGATIF — erin EST capitaine, mais dave n'a pas lié riot : 1 joueur lié sur les
    # 2 qu'impose le format → aucune lineup valide n'est composable.
    _, _, by_e = listing(tokE, "")
    s.check("erin (capitaine, roster 1 lié / 2) : canAccept False",
            by_e.get(TS, {}).get("canAccept"), False)
    s.check("… reason = roster_not_linked", by_e.get(TS, {}).get("reason"), "roster_not_linked")
    st, b = req("POST", f"/matches/{TS}/accept", tokE, {"lineup": [idE, idD]})
    s.check("🔑 l'API confirme (accept → 400)", st, 400, b.get("error", ""))

    # CAS NÉGATIF — roster TROP PETIT, à ne pas confondre avec « roster non lié ».
    # 🔑 Trouvé en review : les deux cas rendaient `roster_not_linked`, donc une équipe
    # d'un seul joueur au compte lié lisait « faites lier vos comptes » alors qu'il lui
    # manquait des JOUEURS — et l'accept répondait, lui, `lineup must contain exactly N
    # players`. Le verdict était juste, la cause était fausse et le conseil inapplicable.
    st, b = req("POST", "/teams", tokC, {"ladderId": VAL2, "name": "MMC" + uuid.uuid4().hex[:5]})
    GAMMA = (b.get("team") or b).get("id")
    s.check("team GAMMA créée (capitaine carol, 1 seul membre) → 201", st, 201, b.get("error", ""))
    link(tokC, "riot")  # carol EST liée : seul le NOMBRE de joueurs manque

    _, _, by_c = listing(tokC, "?limit=100")
    s.check("carol (1 membre lié / 2 requis) : canAccept False",
            by_c.get(TS, {}).get("canAccept"), False)
    s.check("🔑 … reason = roster_too_small (et NON roster_not_linked)",
            by_c.get(TS, {}).get("reason"), "roster_too_small")
    st, b = req("POST", f"/matches/{TS}/accept", tokC, {"lineup": [idC]})
    s.check("🔑 l'API confirme, et sur la TAILLE de la lineup", st, 400, b.get("error", ""))
    s.check("… le message de l'API parle bien de la taille",
            "exactly" in str(b.get("error", "")), True)

    # CONTRÔLE POSITIF — on lie dave : le roster atteint format_size, le verdict bascule.
    link(tokD, "riot")
    _, _, by_e = listing(tokE, "")
    s.check("dave lié → erin bascule à canAccept True", by_e.get(TS, {}).get("canAccept"), True)
    s.check("… et reason repasse à null", by_e.get(TS, {}).get("reason"), None)
    st, b = req("POST", f"/matches/{TS}/accept", tokE, {"lineup": [idE, idD]})
    s.check("🔑 CONTRÔLE POSITIF : l'API accepte bien (200)", st, 200, b.get("error", ""))

    # ─────────────────────────────────────────── 5. EXPIRATION en balayage global
    s.section("Les créneaux périmés restent masqués (balayage global)")

    T5 = slot_at(5)
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T5})
    s.check("alice ouvre un créneau chess → 201", st, 201, b.get("error", ""))
    S5 = b.get("match", {}).get("id")
    _, _, by_c = listing(tokC, "")
    s.check("il est visible avant péremption", S5 in by_c, True)

    # On le pousse sous la barre des 15 min — l'API refuserait de le créer ainsi.
    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    sql(f"update matches set scheduled_at = '{soon.isoformat()}' where id = '{S5}';")
    _, _, by_c = listing(tokC, "")
    s.check("🔑 périmé → masqué du balayage global", S5 in by_c, False)

    # ⚠️ Il faut un observateur pour qui au moins un créneau est ACCEPTABLE, sinon
    # `?acceptable=true` serait vert sur une liste VIDE — vert par construction, donc
    # sans valeur. À ce stade carol est engagée à l'heure du seul créneau chess restant,
    # et erin/dave n'ont pas chess_com : personne ne peut plus rien accepter. On fabrique
    # donc explicitement le cas positif. (Trouvé en voyant ce check ROUGE.)
    link(tokD, "chess_com")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": slot_at(12)})
    s.check("alice ouvre un dernier créneau chess → 201", st, 201, b.get("error", ""))

    # ─────────────────────────────────────────── 6. TRI
    s.section("Tri scheduledAt croissant (la route ne triait pas du tout)")

    _, slots, _ = listing(tokD, "")
    times = [x["scheduledAt"] for x in slots]
    s.check("la liste est triée par scheduledAt croissant", times, sorted(times))
    s.check("… et elle n'est pas vide (le tri porte sur quelque chose)", len(times) > 1, True)

    # ─────────────────────────────────────────── 7. FILTRES
    s.section("Filtres gameId / format / acceptable / limit")

    _, slots, _ = listing(tokD, "?gameId=chess")
    s.check("?gameId=chess → que du chess", {x["gameId"] for x in slots}, {"chess"})

    st, slots, _ = listing(tokD, "?gameId=jeu-inexistant")
    s.check("?gameId inconnu → 200 (filtre, pas une ressource)", st, 200)
    s.check("… et liste vide", slots, [])

    _, slots, _ = listing(tokD, "?format=1v1")
    s.check("?format=1v1 → que du 1v1", {x["format"] for x in slots}, {"1v1"})

    st, _ = req("GET", "/matches?format=9v9", tokD)
    s.check("?format hors enum → 400", st, 400)

    _, slots, _ = listing(tokD, "?acceptable=true")
    s.check("?acceptable=true → tous canAccept", {x["canAccept"] for x in slots} <= {True}, True)
    s.check("… et il en reste (le filtre ne vide pas tout)", len(slots) > 0, True)

    _, slots, _ = listing(tokD, "?acceptable=false")
    s.check("?acceptable=false → aucun canAccept", {x["canAccept"] for x in slots} <= {False}, True)
    s.check("… tous portent un reason non nul", all(x["reason"] for x in slots), True)

    # ⚠️ LE piège que `z.coerce.boolean()` aurait laissé passer : en JS toute chaîne non
    # vide est vraie, donc `acceptable=false` se serait comporté comme `true`. Ce check
    # est le seul qui distingue les deux implémentations.
    _, only_ko, _ = listing(tokD, "?acceptable=false")
    _, only_ok, _ = listing(tokD, "?acceptable=true")
    s.check("🔑 true et false ne rendent PAS le même ensemble",
            {x["id"] for x in only_ko} & {x["id"] for x in only_ok}, set())

    st, _ = req("GET", "/matches?acceptable=peut-etre", tokD)
    s.check("?acceptable non booléen → 400", st, 400)

    _, slots, _ = listing(tokD, "?limit=1")
    s.check("?limit=1 → au plus 1 créneau", len(slots) <= 1, True)

    st, _ = req("GET", "/matches?limit=0", tokD)
    s.check("?limit=0 → 400", st, 400)
    st, _ = req("GET", "/matches?limit=101", tokD)
    s.check("?limit au-dessus du plafond → 400", st, 400)
    st, _ = req("GET", "/matches?limit=abc", tokD)
    s.check("?limit non numérique → 400", st, 400)

    # Combinaison : les filtres se cumulent, ils ne se remplacent pas.
    # ⚠️ Ces 4 checks ASSERTENT LE STATUT. Première rédaction, ils ne lisaient que
    # `slots` — or `listing()` rend `[]` par défaut, donc un 404 et un 200 vide étaient
    # le MÊME vert : ils étaient verts PAR CONSTRUCTION et ne gardaient rien. C'est en
    # les corrigeant qu'est apparu le vrai défaut (un 404 « ladder not found » sur un
    # ladder qui existe bel et bien).
    st, slots, _ = listing(tokD, f"?ladderId={CHESS}&format=1v1")
    s.check("?ladderId + format cohérents → 200", st, 200)
    s.check("… et il reste des créneaux, tous chess", {x["gameId"] for x in slots}, {"chess"})

    st, slots, _ = listing(tokD, f"?ladderId={CHESS}&format=5v5")
    s.check("🔑 ?ladderId valide + format INCOHÉRENT → 200 (le ladder EXISTE)", st, 200)
    s.check("… avec une liste vide, jamais un 404 mensonger", slots, [])

    st, slots, _ = listing(tokD, f"?ladderId={CHESS}&gameId=cs2")
    s.check("🔑 ?ladderId valide + gameId d'un AUTRE jeu → 200", st, 200)
    s.check("… liste vide", slots, [])

    # ─────────────────────────────────────────── 8. MON PROPRE SLOT NE ME BLOQUE PAS
    s.section("Un créneau à MOI qui chevauche n'est PAS un schedule_conflict")

    # 🔑 Le piège le plus fin du ticket. `hasConflictingMatch` est appelé avec
    # LOCKING_STATUSES à l'accept (matchs ACTIFS seulement) et non ENGAGING_STATUSES :
    # mes propres slots `pending` qui chevauchent ne me bloquent pas, puisque accepter
    # les ANNULE (option A). Le verdict doit faire le même choix — sinon tout joueur
    # ayant un créneau ouvert à cette heure verrait « conflit » sur un créneau que l'API
    # accepterait sans broncher, et le bouton disparaîtrait sans raison.
    T7 = slot_at(20)
    st, b = req("POST", "/matches", tokD, {"ladderId": CHESS, "scheduledAt": T7})
    s.check("dave ouvre SON créneau à T7 → 201", st, 201, b.get("error", ""))
    S7d = b.get("match", {}).get("id")
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T7})
    s.check("alice en ouvre un à la MÊME heure → 201", st, 201, b.get("error", ""))
    S7 = b.get("match", {}).get("id")

    # Le DÉPARTAGE par `createdAt` : les deux créneaux ci-dessus sont à la MÊME heure.
    # Un tiers (erin) les voit tous les deux — celui de dave a été créé en premier, il
    # doit sortir en premier. Sans second critère l'ordre des ex æquo n'est garanti par
    # rien, et un simple UPDATE de statut peut les permuter entre deux appels.
    _, slots_e, _ = listing(tokE, "?limit=100")
    at_t7 = [x["id"] for x in slots_e if x["scheduledAt"] == T7]
    s.check("les 2 créneaux ex æquo sont bien visibles par un tiers", len(at_t7), 2)
    s.check("🔑 départage par createdAt : le plus ancien d'abord", at_t7, [S7d, S7])

    _, _, by_d = listing(tokD, "?limit=100")
    s.check("🔑 mon slot pending ne crée PAS de conflit → canAccept True",
            by_d.get(S7, {}).get("canAccept"), True)
    s.check("… et reason reste null", by_d.get(S7, {}).get("reason"), None)
    st, b = req("POST", f"/matches/{S7}/accept", tokD)
    s.check("🔑 l'API confirme (accept → 200)", st, 200, b.get("error", ""))

    # … et la MÊME propriété côté ÉQUIPE (branche `myLockingTeam`), qui n'était pas
    # parcourue : le 1v1 et le 2v2+ passent par deux sources de conflit distinctes, un
    # vert sur l'une ne dit rien de l'autre.
    tokF, idF, _ = register("erin")  # 6e compte : GAMMA a besoin d'un 2e joueur lié
    join_team(GAMMA, idF)
    link(tokF, "riot")
    T8 = slot_at(30)
    st, b = req(
        "POST", "/matches", tokC, {"ladderId": VAL2, "scheduledAt": T8, "lineup": [idC, idF]}
    )
    s.check("GAMMA ouvre un créneau 2v2 à T8 → 201", st, 201, b.get("error", ""))
    S8 = b.get("match", {}).get("id")
    st, b = req(
        "POST", "/matches", tokA, {"ladderId": VAL2, "scheduledAt": T8, "lineup": [idA, idB]}
    )
    s.check("ALPHA ouvre le SIEN à la même heure → 201", st, 201, b.get("error", ""))

    _, _, by_a = listing(tokA, "?limit=100")
    s.check("🔑 2v2+ : le slot pending de MON équipe ne bloque pas → canAccept True",
            by_a.get(S8, {}).get("canAccept"), True)
    s.check("… et reason reste null", by_a.get(S8, {}).get("reason"), None)
    st, b = req("POST", f"/matches/{S8}/accept", tokA, {"lineup": [idA, idB]})
    s.check("🔑 l'API confirme côté équipe (accept → 200)", st, 200, b.get("error", ""))

    # ─────────────────────────────────────────── 9. PARAMÈTRE VIDE = PARAMÈTRE ABSENT
    s.section("Un filtre présent mais vide ne doit PAS rendre 400")

    # 🔑 Un front qui fait `?gameId=${filtre}` avec un filtre non renseigné envoie une
    # chaîne vide. Un 400 laisserait une ligne rouge dans la console Chrome, qui est un
    # motif de rejet du projet. C'est l'usage NORMAL d'une page de filtres.
    for param in ("ladderId", "gameId", "format", "acceptable", "limit"):
        st, _ = req("GET", f"/matches?{param}=", tokC)
        s.check(f"?{param}= (vide) → 200, comme s'il était absent", st, 200)

    st, slots_vide, _ = listing(tokC, "?gameId=&format=&acceptable=&limit=")
    st2, slots_sans, _ = listing(tokC, "")
    s.check("les 5 vides ensemble → 200", st, 200)
    s.check("… et rendent EXACTEMENT la même liste que sans paramètre",
            [x["id"] for x in slots_vide], [x["id"] for x in slots_sans])

    # ⚠️ Rien n'est relâché pour autant : une valeur réellement invalide reste un 400.
    st, _ = req("GET", "/matches?acceptable=1", tokC)
    s.check("🔑 ?acceptable=1 (invalide, pas vide) → toujours 400", st, 400)
    st, _ = req("GET", "/matches?limit=abc", tokC)
    s.check("🔑 ?limit=abc → toujours 400", st, 400)
    st, _ = req("GET", "/matches?ladderId=nope", tokC)
    s.check("🔑 ?ladderId=nope → toujours 400", st, 400)

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
