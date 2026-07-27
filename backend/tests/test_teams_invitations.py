"""B-INV — invitations d'équipe : l'ajout forcé est remplacé par une invitation.

Avant ce ticket, `POST /teams/{id}/members` INSÉRAIT directement l'appartenance : le
capitaine ajoutait un joueur sans son accord et, comme `team_members_user_ladder_unique`
n'autorise qu'une équipe par ladder, cet ajout VERROUILLAIT le joueur sur tout le ladder.
La route n'existe plus ; il faut inviter, et le joueur répond.

Ce que la suite couvre :

  * la route d'ajout forcé a bien DISPARU (404) ;
  * le cycle complet invitation → acceptation / refus / annulation, et le fait que
    l'invité N'EST PAS membre tant qu'il n'a pas accepté ;
  * tous les cas d'échec, chacun avec son `code` stable (le front teste `code`, pas la
    prose de `error`) ;
  * le plafond « membres + invitations en attente ≤ 10 », vérifié à l'invitation ET
    re-vérifié SOUS VERROU à l'acceptation ;
  * l'annulation automatique des autres invitations du joueur sur le même ladder ;
  * la divulgation progressive de `GET /teams/{id}` : les invitations en attente sortent
    aux membres, jamais aux visiteurs ;
  * la disparition des invitations à la dissolution de l'équipe (cascade DB) ;
  * les notifications, et surtout leur destinataire (jamais l'acteur) ;
  * le blocage, honoré comme sur les 4 autres canaux de contact du repo ;
  * la justification n°1 de la table dédiée : un invité qui n'a pas accepté n'est PAS
    alignable dans un match.

⚠️ Les QUATRE courses utilisent une `threading.Barrier` ET la répétition : sans barrière les
threads partent en décalé et ne se croisent jamais ; sans répétition, un tour passe par
hasard (mesuré) — dans les deux cas le test PASSE alors que le bug est là (piège #18).

  1-2. INTRA-ÉQUIPE (dernière place, double accept de la même invitation) : elles prouvent
       que le plafond tient sous concurrence, un check en code n'étant jamais atomique
       (piège #14).
  3.   INTER-ÉQUIPES : défaut de la 1re livraison — le verrou d'équipe seul laissait
       s'interbloquer deux acceptations du même joueur sur deux équipes du même ladder
       (8/8 en 500 au lieu de 409).
  4.   DISSOLUTION × ACCEPTATION : défaut de la 2e livraison — la dissolution écrit
       `team_invitations` par CASCADE et restait hors du verrou (500 pour le CAPITAINE).

⚠️⚠️ La 4e a imposé une leçon de méthode, devenue le **piège #21** : une `Barrier` ne teste
qu'UN SEUL point d'alignement. À 0 ms, ce défaut est invisible sur 12 tours. Il faut BALAYER
un décalage (`time.sleep(step)` dans un seul des deux threads, `step` = 0 → 11 ms) : il tombe
à 5 ms. Barrière **et** balayage, jamais l'un ou l'autre.

⚠️ Cette suite porte aussi le TRIPWIRE de `helpers.join_team()`, qui sème les rosters des
suites matchmaking en SQL. Sa portée est limitée et assumée (voir le commentaire sur place) :
`team_members` n'a que 5 colonnes, dont 4 forcément différentes — il ne prouve aujourd'hui
que `joined_at` renseigné des deux côtés, et servira surtout le jour où une colonne
s'ajoutera. Ce n'est PAS l'équivalence complète que `test_auth_contract.py` établit pour
`helpers.register()`.
"""

import threading
import time
import uuid

from helpers import Suite, future, join_team, ladder_id, link, register, req, sql

FAKE_UUID = "00000000-0000-4000-8000-000000000000"


def team_of(token, ladder, tag):
    """Crée une équipe et rend son id (le créateur en devient capitaine ET membre)."""
    st, b = req("POST", "/teams", token, {"ladderId": ladder, "name": tag + uuid.uuid4().hex[:6]})
    if st != 201:
        raise SystemExit(f"création de team {tag} refusée ({st}) : {b}")
    return b["team"]["id"]


def invite(token, team_id, user_id):
    return req("POST", f"/teams/{team_id}/invitations", token, {"userId": user_id})


def notif_types(token):
    """Les types de notification reçus par ce compte (le plus récent d'abord)."""
    _, b = req("GET", "/notifications", token)
    return [n.get("type") for n in b.get("notifications", [])]


def inv_status(invitation_id):
    return sql(f"select status from team_invitations where id = '{invitation_id}';")


def members_count(team_id):
    return sql(f"select count(*) from team_members where team_id = '{team_id}';")


def fire(results, tag, method, path, token, body=None, gate=None, delay=0.0):
    # La barrière fait partir les requêtes au MÊME instant : c'est elle qui rend la course
    # réelle. Sans elle le test est un faux négatif (piège #18).
    if gate:
        gate.wait()
    # ⚠️ `delay` : une barrière ne teste QU'UN SEUL point d'alignement. Certains
    # interblocages n'existent que si la 2e requête arrive pendant une fenêtre précise de
    # la 1re — synchronisées à 0 ms, les deux transactions ne se croisent jamais au bon
    # endroit et le test reste vert. Balayer le décalage est ce qui les fait tomber.
    if delay:
        time.sleep(delay)
    results[tag] = req(method, path, token, body)


def run():
    s = Suite("B-INV — invitations d'équipe (POST /teams/:id/invitations & co)")

    tokA, idA, pseudoA = register("alice")  # capitaine
    tokB, idB, pseudoB = register("bob")  # l'invité principal
    tokC, idC, _ = register("carol")  # étrangère à l'équipe
    tokD, idD, _ = register("dave")  # refus / annulation
    tokE, idE, _ = register("erin")  # cas « il a rejoint ailleurs »

    VAL2 = ladder_id(tokA, "val", "2v2")
    TEAM = team_of(tokA, VAL2, "Inv")

    # ─────────────────────────────────────────── la route d'ajout forcé a disparu
    s.section("POST /teams/:id/members n'existe plus")
    st, _ = req("POST", f"/teams/{TEAM}/members", tokA, {"userId": idB})
    s.check("l'ajout forcé d'un membre → 404 (route supprimée)", st, 404)
    s.check("et personne n'a été ajouté", members_count(TEAM), "1")
    st, _ = req("DELETE", f"/teams/{TEAM}/members/{idB}", tokA)
    s.check("le KICK, lui, existe toujours (idempotent) → 200", st, 200)

    # ─────────────────────────────────────────── gardes d'entrée
    s.section("Gardes d'entrée (401 avant 400, Zod, capitaine)")
    st, _ = req("POST", "/teams/pas-un-uuid/invitations", None, {"userId": idB})
    s.check("sans token → 401 (Zod passe APRÈS authenticate)", st, 401)
    st, _ = req("POST", "/teams/pas-un-uuid/invitations", tokA, {"userId": idB})
    s.check(":id non-uuid → 400 (jamais 500)", st, 400)
    st, _ = invite(tokA, TEAM, "pas-un-uuid")
    s.check("userId non-uuid → 400", st, 400)
    st, _ = req("POST", f"/teams/{TEAM}/invitations", tokA, {})
    s.check("body sans userId → 400", st, 400)
    st, b = invite(tokA, FAKE_UUID, idB)
    s.check("team inconnue → 404", (st, b.get("code")), (404, "team_not_found"))
    st, b = invite(tokA, TEAM, FAKE_UUID)
    s.check("joueur inconnu → 404", (st, b.get("code")), (404, "user_not_found"))
    st, b = invite(tokC, TEAM, idB)
    s.check("un non-capitaine invite → 403", (st, b.get("code")), (403, "not_captain"))
    s.check("  message explicite", b.get("error"), "only the captain can invite players")

    # ─────────────────────────────────────────── cycle nominal
    s.section("Cycle nominal : invitée ≠ membre, puis acceptation")
    st, b = invite(tokA, TEAM, idB)
    INV_B = (b.get("invitation") or {}).get("id")
    s.check("alice invite bob → 201", st, 201, b.get("error", ""))
    s.check("l'invitation est `pending`", (b.get("invitation") or {}).get("status"), "pending")
    s.check("elle porte le joueur invité", ((b.get("invitation") or {}).get("user") or {}).get("pseudo"), pseudoB)
    s.check("🔑 bob n'est PAS membre pour autant", members_count(TEAM), "1")

    _, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check("GET /teams/:id (capitaine) → isMember true", b.get("isMember"), True)
    s.check("  le roster reste à 1", len(b.get("members", [])), 1)
    s.check("  l'invitation en attente est visible", [i["user"]["id"] for i in b.get("invitations", [])], [idB])

    _, b = req("GET", f"/teams/{TEAM}", tokC)
    s.check("GET /teams/:id (visiteur) → isMember false", b.get("isMember"), False)
    s.check("🔒 un visiteur n'apprend PAS qui a été sollicité", "invitations" in b, False)

    _, b = req("GET", "/teams/invitations/me", tokB)
    s.check("bob voit son invitation", [i["id"] for i in b.get("invitations", [])], [INV_B])
    s.check("  avec l'équipe et l'inviteur", (b["invitations"][0]["team"]["id"], b["invitations"][0]["invitedBy"]["pseudo"]), (TEAM, pseudoA))
    _, b = req("GET", "/teams/invitations/me", tokA)
    s.check("alice, elle, n'a rien reçu", b.get("invitations"), [])

    st, b = invite(tokA, TEAM, idB)
    s.check("réinviter le même joueur → 409", (st, b.get("code")), (409, "already_invited"))

    s.check("bob a bien reçu la notif d'invitation", "team_invitation_received" in notif_types(tokB), True)
    s.check("alice (l'actrice) n'en a PAS reçu", "team_invitation_received" in notif_types(tokA), False)

    st, b = req("POST", f"/teams/invitations/{INV_B}/accept", tokB)
    s.check("bob accepte → 200", st, 200, b.get("error", ""))
    s.check("  la réponse rend l'équipe rejointe", b.get("teamId"), TEAM)
    s.check("🔑 bob est MAINTENANT membre", members_count(TEAM), "2")
    s.check("l'invitation passe `accepted`", inv_status(INV_B), "accepted")
    s.check("  et `responded_at` est renseigné", sql(f"select responded_at is not null from team_invitations where id='{INV_B}';"), "t")
    _, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check("elle disparaît des invitations en attente", b.get("invitations"), [])
    s.check("le capitaine est notifié de l'acceptation", "team_invitation_accepted" in notif_types(tokA), True)
    s.check("bob (l'acteur) ne s'auto-notifie pas", "team_invitation_accepted" in notif_types(tokB), False)

    st, b = req("POST", f"/teams/invitations/{INV_B}/accept", tokB)
    s.check("ré-accepter → 409", (st, b.get("code")), (409, "not_pending"))

    # 🔎 TRIPWIRE de `helpers.join_team()`. Honnêteté sur sa portée : `team_members` n'a
    # aujourd'hui que 5 colonnes, dont 4 sont forcément différentes entre deux lignes (id,
    # team_id, user_id, ladder_id) — la comparaison ne « valide » donc pas grand-chose
    # AUJOURD'HUI. Ce qu'elle fait : (1) elle vérifie la seule colonne réellement comparable,
    # `joined_at`, renseignée des DEUX côtés (le helper la laisse au DEFAULT, l'API aussi) ;
    # (2) elle se déclenchera le jour où une colonne s'ajoutera (rôle, invited_by, statut…)
    # et que seule l'API la remplira. Ce jour-là, on corrige le HELPER, pas la suite.
    TEAM_SEED = team_of(tokC, VAL2, "Seed")
    join_team(TEAM_SEED, idD)
    shape = (
        "select jsonb_set(to_jsonb(t) - 'id' - 'team_id' - 'user_id' - 'ladder_id', "
        "'{joined_at}', to_jsonb(t.joined_at is not null)) from team_members t "
    )
    accepted_shape = sql(shape + f"where team_id='{TEAM}' and user_id='{idB}';")
    seeded_shape = sql(shape + f"where team_id='{TEAM_SEED}' and user_id='{idD}';")
    s.check("🔑 appartenance ACCEPTÉE ≡ appartenance SEMÉE (join_team)", accepted_shape, seeded_shape)
    s.check("  et `joined_at` est bien renseigné des deux côtés", accepted_shape, '{"joined_at": true}')

    # ─────────────────────────────────────────── déjà membre / déjà une équipe
    s.section("Refus métier : déjà membre, déjà une équipe sur ce ladder")
    st, b = invite(tokA, TEAM, idB)
    s.check("inviter un membre de l'équipe → 409", (st, b.get("code")), (409, "already_member"))
    st, b = invite(tokA, TEAM, idA)
    s.check("le capitaine s'invite lui-même → 409", (st, b.get("code")), (409, "already_member"))
    st, b = invite(tokA, TEAM, idD)  # dave a été semé dans TEAM_SEED, même ladder
    s.check("inviter un joueur déjà en équipe sur ce ladder → 409", (st, b.get("code")), (409, "already_in_team_on_ladder"))
    s.check("  message explicite", b.get("error"), "this player already has a team on this ladder")

    # ─────────────────────────────────────────── blocage
    s.section("Blocage : l'invitation est un canal de contact comme les 4 autres")
    tokBl, idBl, _ = register("erin")
    TEAM_BL = team_of(tokBl, ladder_id(tokBl, "rl", "2v2"), "Block")
    tokVi, idVi, _ = register("carol")
    st, b = invite(tokBl, TEAM_BL, idVi)
    s.check("témoin : sans blocage, l'invitation part → 201", st, 201, b.get("error", ""))
    req("DELETE", f"/teams/{TEAM_BL}/invitations/{b['invitation']['id']}", tokBl)
    st, _ = req("POST", f"/blocks/{idBl}", tokVi)
    s.check("la cible bloque le capitaine → 201", st, 201)
    # ⚠️ Compter AVANT : l'invitation témoin ci-dessus a légitimement notifié cette cible.
    # Un « aucune notif de ce type » serait faux pour une raison qui n'a rien à voir avec
    # le blocage — c'est le compteur qui doit rester STABLE, pas la liste qui doit être vide.
    notifs_before = notif_types(tokVi).count("team_invitation_received")
    st, b = invite(tokBl, TEAM_BL, idVi)
    s.check("🔑 inviter quelqu'un qui m'a bloqué → 404 (indistinguable d'un inconnu)", (st, b.get("code")), (404, "user_not_found"))
    s.check("  et aucune invitation n'a été créée", sql(f"select count(*) from team_invitations where team_id='{TEAM_BL}' and user_id='{idVi}' and status='pending';"), "0")
    s.check("  ni aucune notification de PLUS", notif_types(tokVi).count("team_invitation_received"), notifs_before)
    # Sens inverse : c'est le CAPITAINE qui bloque. `isBlocked()` est symétrique.
    req("DELETE", f"/blocks/{idBl}", tokVi)
    req("POST", f"/blocks/{idVi}", tokBl)
    st, b = invite(tokBl, TEAM_BL, idVi)
    s.check("  blocage dans l'autre sens → 404 aussi", (st, b.get("code")), (404, "user_not_found"))
    req("DELETE", f"/blocks/{idVi}", tokBl)

    # ─────────────────────────────────────────── refus, annulation, ré-invitation
    s.section("Refus et annulation libèrent la place")
    tokF, idF, _ = register("erin")
    st, b = invite(tokA, TEAM, idF)
    INV_F = (b.get("invitation") or {}).get("id")
    s.check("alice invite un 3e joueur → 201", st, 201, b.get("error", ""))
    st, b = req("POST", f"/teams/invitations/{INV_F}/decline", tokC)
    s.check("refuser l'invitation d'un AUTRE → 403", (st, b.get("code")), (403, "not_your_invitation"))
    st, b = req("POST", f"/teams/invitations/{INV_F}/accept", tokC)
    s.check("accepter l'invitation d'un AUTRE → 403", (st, b.get("code")), (403, "not_your_invitation"))
    st, _ = req("POST", f"/teams/invitations/{INV_F}/decline", tokF)
    s.check("le destinataire refuse → 200", st, 200)
    s.check("  statut `declined`", inv_status(INV_F), "declined")
    s.check("  le capitaine est notifié du refus", "team_invitation_declined" in notif_types(tokA), True)
    s.check("  toujours 2 membres", members_count(TEAM), "2")
    st, b = req("POST", f"/teams/invitations/{INV_F}/decline", tokF)
    s.check("re-refuser → 409", (st, b.get("code")), (409, "not_pending"))

    st, b = invite(tokA, TEAM, idF)
    INV_F2 = (b.get("invitation") or {}).get("id")
    s.check("🔑 réinviter APRÈS un refus → 201 (l'index unique est PARTIEL)", st, 201, b.get("error", ""))
    st, b = req("DELETE", f"/teams/{TEAM}/invitations/{INV_F2}", tokC)
    s.check("annuler sans être capitaine → 403", (st, b.get("code")), (403, "not_captain"))
    st, _ = req("DELETE", f"/teams/{TEAM}/invitations/{INV_F2}", tokA)
    s.check("le capitaine annule → 200", st, 200)
    s.check("  statut `cancelled` (PAS `declined` : le joueur n'a rien refusé)", inv_status(INV_F2), "cancelled")
    st, b = req("DELETE", f"/teams/{TEAM}/invitations/{INV_F2}", tokA)
    s.check("re-annuler → 404", (st, b.get("code")), (404, "invitation_not_found"))
    st, b = req("POST", f"/teams/invitations/{INV_F2}/accept", tokF)
    s.check("accepter une invitation annulée → 409", (st, b.get("code")), (409, "not_pending"))
    st, b = req("DELETE", f"/teams/{TEAM}/invitations/{FAKE_UUID}", tokA)
    s.check("annuler une invitation inconnue → 404", (st, b.get("code")), (404, "invitation_not_found"))
    st, b = req("POST", f"/teams/invitations/{FAKE_UUID}/accept", tokF)
    s.check("accepter une invitation inconnue → 404", (st, b.get("code")), (404, "invitation_not_found"))
    st, b = invite(tokA, TEAM, idF)
    INV_F3 = (b.get("invitation") or {}).get("id")
    s.check("🔑 réinviter APRÈS une annulation → 201", st, 201, b.get("error", ""))
    req("DELETE", f"/teams/{TEAM}/invitations/{INV_F3}", tokA)

    # ─────────────────────────────────────────── acceptation exclusive par ladder
    s.section("Accepter chez l'un annule les invitations chez les autres (même ladder)")
    TEAM2 = team_of(tokB, ladder_id(tokB, "val", "5v5"), "Rival")  # bob capitaine ailleurs
    VAL5 = sql(f"select ladder_id from teams where id = '{TEAM2}';")
    TEAM3 = team_of(tokC, VAL5, "Rival2")
    tokG, idG, _ = register("erin")
    st, b = invite(tokB, TEAM2, idG)
    INV_G2 = (b.get("invitation") or {}).get("id")
    s.check("équipe 1 invite le joueur → 201", st, 201, b.get("error", ""))
    st, b = invite(tokC, TEAM3, idG)
    INV_G3 = (b.get("invitation") or {}).get("id")
    s.check("🔑 une AUTRE équipe du même ladder peut aussi l'inviter → 201", st, 201, b.get("error", ""))
    _, b = req("GET", "/teams/invitations/me", tokG)
    s.check("il a bien 2 invitations en attente", len(b.get("invitations", [])), 2)
    st, _ = req("POST", f"/teams/invitations/{INV_G2}/accept", tokG)
    s.check("il accepte la première → 200", st, 200)
    s.check("  la seconde passe `cancelled` (pas `declined`)", inv_status(INV_G3), "cancelled")
    _, b = req("GET", "/teams/invitations/me", tokG)
    s.check("  sa liste d'invitations est vide", b.get("invitations"), [])
    st, b = req("POST", f"/teams/invitations/{INV_G3}/accept", tokG)
    s.check("  et la seconde n'est plus acceptable → 409", (st, b.get("code")), (409, "not_pending"))

    # 🔑 MÊME INVARIANT PAR L'AUTRE PORTE : on obtient aussi une équipe en la CRÉANT.
    # Sans cette annulation, l'invitation restait `pending` pour toujours (plus jamais
    # acceptable → 409 already_in_team) tout en OCCUPANT une place du plafond de 10 de
    # l'équipe émettrice : un capitaine perdait un slot sans rien pour l'expliquer.
    s.section("Créer sa propre équipe annule aussi mes invitations en attente du ladder")
    tokCr, idCr, _ = register("dave")
    ISSUER = team_of(tokC, ladder_id(tokC, "cs2", "5v5"), "Issuer")
    ISSUER_LADDER = sql(f"select ladder_id from teams where id = '{ISSUER}';")
    st, b = invite(tokC, ISSUER, idCr)
    INV_CR = (b.get("invitation") or {}).get("id")
    s.check("une équipe l'invite → 201", st, 201, b.get("error", ""))
    s.check("  elle occupe une place du plafond de l'émettrice", sql(f"select count(*) from team_invitations where team_id='{ISSUER}' and status='pending';"), "1")
    st, b = req("POST", "/teams", tokCr, {"ladderId": ISSUER_LADDER, "name": "Own" + uuid.uuid4().hex[:6]})
    s.check("il crée SA propre équipe sur ce ladder → 201", st, 201, b.get("error", ""))
    s.check("🔑 l'invitation passe `cancelled` (pas `declined`)", inv_status(INV_CR), "cancelled")
    _, b = req("GET", "/teams/invitations/me", tokCr)
    s.check("  elle disparaît de sa liste", b.get("invitations"), [])
    s.check("🔑 la place est RENDUE à l'équipe émettrice", sql(f"select count(*) from team_invitations where team_id='{ISSUER}' and status='pending';"), "0")
    st, b = req("POST", f"/teams/invitations/{INV_CR}/accept", tokCr)
    s.check("  et elle n'est plus acceptable → 409", (st, b.get("code")), (409, "not_pending"))

    # « il a rejoint une autre équipe du ladder ENTRE-TEMPS » : on reproduit le cas en
    # court-circuitant l'annulation en cascade (l'invitation est semée après coup).
    s.section("Cas négatif : accepter alors qu'on a déjà rejoint une autre équipe du ladder")
    TEAM4 = team_of(tokD, VAL5, "Late")
    inv_late = sql(
        "insert into team_invitations (team_id, user_id, ladder_id, invited_by) values "
        f"('{TEAM4}', '{idG}', '{VAL5}', '{idD}') returning id;"
    )
    st, b = req("POST", f"/teams/invitations/{inv_late}/accept", tokG)
    s.check("accepter alors qu'on a déjà une équipe sur ce ladder → 409", (st, b.get("code")), (409, "already_in_team"))
    s.check("  l'invitation est restée `pending` (transaction annulée)", inv_status(inv_late), "pending")
    s.check("  et le roster de l'équipe n'a pas bougé", members_count(TEAM4), "1")

    # ─────────────────────────────────────────── plafond 10
    s.section("Plafond : membres + invitations en attente ≤ 10")
    CAP = team_of(tokE, VAL5, "Cap")
    fillers = [register("dave") for _ in range(8)]
    for _tok, uid, _p in fillers:
        join_team(CAP, uid)
    s.check("équipe portée à 9 membres (semés)", members_count(CAP), "9")
    tok10, id10, _ = register("bob")
    st, b = invite(tokE, CAP, id10)
    INV_10 = (b.get("invitation") or {}).get("id")
    s.check("la 10e place s'invite encore → 201", st, 201, b.get("error", ""))
    tok11, id11, _ = register("bob")
    st, b = invite(tokE, CAP, id11)
    s.check("🔑 la 11e est refusée : l'invitation en attente COMPTE → 409", (st, b.get("code")), (409, "roster_full"))
    s.check("  message explicite", b.get("error"), "team is full (members and pending invitations)")
    st, _ = req("DELETE", f"/teams/{CAP}/invitations/{INV_10}", tokE)
    s.check("annuler l'invitation libère la place → 200", st, 200)
    st, b = invite(tokE, CAP, id11)
    INV_11 = (b.get("invitation") or {}).get("id")
    s.check("  une nouvelle invitation redevient possible → 201", st, 201, b.get("error", ""))

    # CAS NÉGATIF re-vérifié SOUS VERROU : le roster devient plein APRÈS l'invitation.
    # On sème le 10e membre en SQL (ce que ferait une acceptation concurrente).
    join_team(CAP, id10)
    s.check("le roster atteint 10 par une autre voie", members_count(CAP), "10")
    st, b = req("POST", f"/teams/invitations/{INV_11}/accept", tok11)
    s.check("🔑 accepter dans une équipe devenue pleine → 409", (st, b.get("code")), (409, "roster_full"))
    s.check("  aucun 11e membre n'a été créé", members_count(CAP), "10")
    s.check("  l'invitation reste `pending`", inv_status(INV_11), "pending")

    # ─────────────────────────────────────────── courses réelles
    s.section("Courses (threading.Barrier) — le plafond tient sous concurrence")
    RACE = team_of(tokA, ladder_id(tokA, "cs2", "5v5"), "Race")
    CS5 = sql(f"select ladder_id from teams where id = '{RACE}';")
    racers = [register("carol") for _ in range(8)]
    for _tok, uid, _p in racers:
        join_team(RACE, uid)
    s.check("équipe de course portée à 9 membres", members_count(RACE), "9")
    # DEUX invitations en attente sur une équipe à 9 membres : l'API ne le permettrait pas
    # (plafond), on force donc l'état en SQL. C'est exactement la fenêtre que le verrou doit
    # fermer : sans lui, les deux acceptations liraient « 9 » et passeraient ensemble → 11.
    tokR1, idR1, _ = register("dave")
    tokR2, idR2, _ = register("dave")
    inv1 = sql(f"insert into team_invitations (team_id, user_id, ladder_id, invited_by) values ('{RACE}', '{idR1}', '{CS5}', '{idA}') returning id;")
    inv2 = sql(f"insert into team_invitations (team_id, user_id, ladder_id, invited_by) values ('{RACE}', '{idR2}', '{CS5}', '{idA}') returning id;")

    # ⚠️ RÉPÉTER : une course ne se déclenche pas à tous les coups (piège #18). Un seul
    # essai est vert MÊME SANS VERROU — mesuré : les deux transactions se sérialisent par
    # hasard. Sur 6 tours, l'absence de verrou produit au moins un tour à 2 × 200 (roster
    # à 11). C'est ce qui rend ce test un VRAI positif et pas une formalité.
    ROUNDS = 6
    outcomes, rosters = [], []
    for _ in range(ROUNDS):
        gate = threading.Barrier(2)
        res = {}
        ts = [
            threading.Thread(target=fire, args=(res, "r1", "POST", f"/teams/invitations/{inv1}/accept", tokR1, None, gate)),
            threading.Thread(target=fire, args=(res, "r2", "POST", f"/teams/invitations/{inv2}/accept", tokR2, None, gate)),
        ]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        outcomes.append((sorted([res["r1"][0], res["r2"][0]]), (res["r1"] if res["r1"][0] != 200 else res["r2"])[1].get("code")))
        rosters.append(members_count(RACE))
        # Remise en état pour le tour suivant : on retire le gagnant et on rend les deux
        # invitations `pending`. 1 seul aller-retour SQL, l'équipe reste à 9 membres.
        sql(
            f"delete from team_members where team_id = '{RACE}' and user_id in ('{idR1}', '{idR2}'); "
            f"update team_invitations set status = 'pending', responded_at = null where id in ('{inv1}', '{inv2}');"
        )
    s.check(f"🔑 {ROUNDS} courses sur la dernière place → toujours un 200 et un 409", sorted({o[0][0] for o in outcomes} | {o[0][1] for o in outcomes}), [200, 409])
    s.check("  le roster ne dépasse JAMAIS 10", sorted(set(rosters)), ["10"])
    s.check("  et le perdant sait toujours pourquoi", sorted({o[1] for o in outcomes}), ["roster_full"])

    # ⚠️⚠️ COURSE INTER-ÉQUIPES — celle qui a manqué à la 1re livraison, et le seul cas qui
    # sort du périmètre d'un verrou par équipe. Les deux courses ci-dessus sont INTRA-équipe :
    # les deux transactions se disputent la même clé consultative, donc elles se sérialisent
    # « toutes seules ». Ici, deux équipes DIFFÉRENTES du même ladder acceptent le même
    # joueur : les clés `team:<id>` sont DISJOINTES, et les transactions se croisent sur des
    # verrous de LIGNE de portée (joueur, ladder) —
    #   * l'index unique `team_members_user_ladder_unique` (insertion de l'appartenance),
    #   * l'UPDATE d'annulation en cascade, filtré sur `user_id + ladder_id`, qui touche des
    #     lignes appartenant à l'AUTRE équipe.
    # T1 tient l'invitation de T2 et veut l'index ; T2 tient l'index et veut l'invitation :
    # interblocage, Postgres tue une transaction → **500 sur un conflit métier normal**
    # (openapi promet 409). Reproduit 12/12 avant le correctif (verrous TRIÉS
    # `team:<id>` + `user:<id>:<ladder>`, patron de `lockCompetitors` dans matches.ts).
    # Le scénario est légitime et documenté plus haut : « une AUTRE équipe du même ladder
    # peut aussi l'inviter ». En vrai : deux boutons « Accepter » côte à côte dans la cloche.
    s.section("Course INTER-ÉQUIPES — le même joueur accepté par 2 équipes du même ladder")
    CROSS = ladder_id(tokA, "rl", "2v2")
    tokX, idX, _ = register("alice")
    tokY, idY, _ = register("bob")
    CROSS1 = team_of(tokX, CROSS, "Cross1")
    CROSS2 = team_of(tokY, CROSS, "Cross2")
    tokZ, idZ, _ = register("carol")
    st, b = invite(tokX, CROSS1, idZ)
    INV_X = (b.get("invitation") or {}).get("id")
    s.check("équipe 1 invite le joueur → 201", st, 201, b.get("error", ""))
    st, b = invite(tokY, CROSS2, idZ)
    INV_Y = (b.get("invitation") or {}).get("id")
    s.check("équipe 2 invite le MÊME joueur → 201", st, 201, b.get("error", ""))

    ROUNDS_X = 8
    cross_codes, cross_500 = [], []
    for _ in range(ROUNDS_X):
        gate = threading.Barrier(2)
        res = {}
        ts = [
            threading.Thread(target=fire, args=(res, "x", "POST", f"/teams/invitations/{INV_X}/accept", tokZ, None, gate)),
            threading.Thread(target=fire, args=(res, "y", "POST", f"/teams/invitations/{INV_Y}/accept", tokZ, None, gate)),
        ]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        got = sorted([res["x"][0], res["y"][0]])
        cross_codes.append(got)
        cross_500 += [c for c in got if c >= 500]
        # Remise en état : on retire l'appartenance gagnante et on rend les 2 invitations
        # `pending` (l'acceptation gagnante en a passé une `accepted` et l'autre `cancelled`).
        sql(
            f"delete from team_members where user_id = '{idZ}' and ladder_id = '{CROSS}'; "
            f"update team_invitations set status = 'pending', responded_at = null where id in ('{INV_X}', '{INV_Y}');"
        )
    s.check(f"🔑 {ROUNDS_X} courses inter-équipes → JAMAIS de 500 (interblocage)", cross_500, [])
    s.check("  chaque tour : exactement un 200 et un 409", sorted({tuple(c) for c in cross_codes}), [(200, 409)])

    # Double acceptation de LA MÊME invitation : l'UPDATE conditionnel doit en sérialiser un.
    RACE2 = team_of(tokB, ladder_id(tokB, "cs2", "2v2"), "Race2")
    tokR3, idR3, _ = register("erin")
    st, b = invite(tokB, RACE2, idR3)
    INV_R3 = (b.get("invitation") or {}).get("id")
    s.check("invitation de préparation → 201", st, 201, b.get("error", ""))
    gate = threading.Barrier(2)
    res = {}
    ts = [
        threading.Thread(target=fire, args=(res, f"d{i}", "POST", f"/teams/invitations/{INV_R3}/accept", tokR3, None, gate))
        for i in (1, 2)
    ]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    s.check("2 acceptations simultanées de LA MÊME invitation → un 200, un 409", sorted([res["d1"][0], res["d2"][0]]), [200, 409])
    s.check("  une seule ligne d'appartenance", sql(f"select count(*) from team_members where team_id='{RACE2}' and user_id='{idR3}';"), "1")

    # ⚠️⚠️ COURSE DISSOLUTION × ACCEPTATION — le 3e cas de la même famille, introduit par ce
    # ticket. La dissolution écrit `team_invitations` **par CASCADE** : elle est donc, elle
    # aussi, une route qui écrit les ressources protégées par `lockRoster`, alors qu'elle ne
    # prenait que son `SELECT … FOR UPDATE` sur `teams` (hérité de B11). Le cycle :
    #   * `accept`  tient la ligne `team_invitations` (UPDATE → `accepted`), puis demande le
    #     `FOR KEY SHARE` sur `teams` que réclame la FK de son INSERT dans `team_members` ;
    #   * `disband` tient le `FOR UPDATE` sur `teams`, puis demande cette même ligne
    #     d'invitation (cascade du DELETE).
    # Avant B-INV il n'y avait pas de seconde ressource — B11 note que la dissolution ne
    # faisait que « patienter » face à un ajout concurrent. C'est la ligne d'invitation qui
    # ferme le cycle, et un CAPITAINE pouvait recevoir un 500 sur une dissolution légitime.
    #
    # 🔑 MÉTHODE : ce défaut ne sort JAMAIS avec une barrière seule (12 tours à 0 ms = vert).
    # Une barrière ne teste qu'UN point d'alignement ; ici la fenêtre s'ouvre quelques
    # millisecondes après le départ de l'acceptation. On BALAIE donc un décalage.
    s.section("Course DISSOLUTION × ACCEPTATION — balayage de décalage (pas qu'une barrière)")
    tokDi, idDi, _ = register("dave")  # capitaine qui dissout
    tokIn, idIn, _ = register("erin")  # invité qui accepte au même instant
    DIS_LADDER = ladder_id(tokDi, "rl", "3v3")
    disband_codes, disband_5xx = [], []
    for step_ms in range(0, 12):  # 0 → 11 ms, la fenêtre mesurée était vers 6-8 ms
        team = team_of(tokDi, DIS_LADDER, "Race3")
        _, b = invite(tokDi, team, idIn)
        inv = (b.get("invitation") or {}).get("id")
        # ⚠️ Ce `continue` peut rendre la boucle MUETTE : si l'invitation échouait à chaque
        # tour (429, régression sur la route…), rien ne serait joué et les deux assertions
        # ci-dessous resteraient vertes sur des listes vides. D'où le compteur de tours
        # RÉELLEMENT joués, vérifié plus bas — même famille de problème que le piège #21.
        if not inv:
            continue
        gate = threading.Barrier(2)
        res = {}
        ts = [
            threading.Thread(target=fire, args=(res, "accept", "POST", f"/teams/invitations/{inv}/accept", tokIn, None, gate)),
            threading.Thread(target=fire, args=(res, "disband", "DELETE", f"/teams/{team}", tokDi, None, gate, step_ms / 1000)),
        ]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        disband_codes.append((step_ms, res["accept"][0], res["disband"][0]))
        disband_5xx += [c for c in (res["accept"][0], res["disband"][0]) if c >= 500]
        # Table rase : si la dissolution a échoué (interblocage), l'équipe survivrait et le
        # tour suivant se prendrait un 409 « déjà une équipe sur ce ladder » à la création.
        sql(f"delete from teams where id = '{team}';")
    s.check("🔑 la boucle a bien joué ses 12 tours (pas de silence)", len(disband_codes), 12)
    s.check("🔑 12 décalages dissolution × acceptation → JAMAIS de 500", disband_5xx, [], str(disband_codes))
    s.check("  les deux camps sortent en 2xx/4xx uniquement", sorted({c for _, a, d in disband_codes for c in (a, d)}), sorted({c for _, a, d in disband_codes for c in (a, d)} - {500}))

    # ─────────────────────────────────────────── l'invité n'est PAS un membre
    # 🔑 C'est la JUSTIFICATION N°1 de la table dédiée : `team_members` est lu à ~40 endroits
    # qui signifient tous « X est membre de Y ». Un statut porté par cette table aurait rendu
    # un invité non-acceptant alignable en match. Ce cas l'assert, avec son contrôle positif
    # (le même lineup passe APRÈS acceptation — sinon le 400 pourrait venir d'autre chose).
    s.section("Un invité qui n'a pas accepté n'est PAS alignable en match")
    tokM, idM, _ = register("alice")
    tokN, idN, _ = register("bob")
    link(tokM, "riot")  # val exige un compte riot lié (§5.1)
    link(tokN, "riot")
    TEAM_AL = team_of(tokM, VAL2, "Align")
    st, b = invite(tokM, TEAM_AL, idN)
    INV_AL = (b.get("invitation") or {}).get("id")
    s.check("invitation posée, non acceptée → 201", st, 201, b.get("error", ""))
    st, b = req("POST", "/matches", tokM, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idM, idN]})
    s.check("🔑 aligner un joueur seulement INVITÉ → 400", st, 400, b.get("error", ""))
    st, _ = req("POST", f"/teams/invitations/{INV_AL}/accept", tokN)
    s.check("il accepte → 200", st, 200)
    st, b = req("POST", "/matches", tokM, {"ladderId": VAL2, "scheduledAt": future(), "lineup": [idM, idN]})
    s.check("  contrôle positif : le MÊME lineup passe une fois accepté → 201", st, 201, b.get("error", ""))

    # ─────────────────────────────────────────── dissolution
    s.section("Dissoudre l'équipe fait disparaître ses invitations (cascade, sans notif)")
    DEAD = team_of(tokD, ladder_id(tokD, "rl", "3v3"), "Dead")
    tokH, idH, _ = register("erin")
    st, b = invite(tokD, DEAD, idH)
    INV_H = (b.get("invitation") or {}).get("id")
    s.check("invitation posée → 201", st, 201, b.get("error", ""))
    st, _ = req("DELETE", f"/teams/{DEAD}", tokD)
    s.check("le capitaine dissout l'équipe → 200", st, 200)
    s.check("🔑 l'invitation a disparu (ON DELETE CASCADE)", sql(f"select count(*) from team_invitations where id = '{INV_H}';"), "0")
    _, b = req("GET", "/teams/invitations/me", tokH)
    s.check("  elle ne traîne plus dans la liste de l'invité", b.get("invitations"), [])
    st, b = req("POST", f"/teams/invitations/{INV_H}/accept", tokH)
    s.check("  et n'est plus acceptable → 404", (st, b.get("code")), (404, "invitation_not_found"))

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
