"""Recette B-Social-Data : GET /messages/conversations + friends sent/cancel.

Tape sur le vrai backend + vraie base de dev. Les DM n'ont pas de route REST
d'envoi (c'est du WebSocket), donc on insère les lignes `messages` en SQL direct
via helpers.sql() pour contrôler les timestamps (et donc l'ordre attendu).
"""

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import Suite, register, req, sql, cleanup  # noqa: E402


def run():
    s = Suite("B-Social-Data — conversations + friends sent/cancel")

    a_tok, a_id, a_pseudo = register("alice")
    b_tok, b_id, b_pseudo = register("bob")
    c_tok, c_id, c_pseudo = register("carol")
    d_tok, d_id, d_pseudo = register("dave")
    e_tok, e_id, e_pseudo = register("erin")

    # --- Cas 1 : aucune conversation -> {conversations: []} 200 -------------
    s.section("Cas 1 — conversations vides")
    st, bd = req("GET", "/messages/conversations", a_tok)
    s.check("1. status 200", st, 200)
    s.check("1. conversations == []", bd.get("conversations"), [])

    # --- Construire les amitiés --------------------------------------------
    s.section("Setup amitiés")
    # alice <-> bob accepté
    st, bd = req("POST", "/friends", a_tok, {"addresseeId": b_id})
    fs_ab = bd["friendship"]["id"]
    req("POST", f"/friends/{fs_ab}/accept", b_tok)
    # alice <-> carol accepté
    st, bd = req("POST", "/friends", a_tok, {"addresseeId": c_id})
    fs_ac = bd["friendship"]["id"]
    req("POST", f"/friends/{fs_ac}/accept", c_tok)
    # dave -> alice pending (reçue par alice)
    st, bd = req("POST", "/friends", d_tok, {"addresseeId": a_id})
    fs_da = bd["friendship"]["id"]
    # alice -> erin pending (envoyée par alice)
    st, bd = req("POST", "/friends", a_tok, {"addresseeId": e_id})
    fs_ae = bd["friendship"]["id"]
    s.check("setup ids présents", all([fs_ab, fs_ac, fs_da, fs_ae]), True)

    # --- Insérer des DM (SQL direct, timestamps contrôlés) -----------------
    # Les derniers messages bob/carol ont volontairement le MÊME timestamp :
    # l'id départage à la fois le dernier message par partenaire et l'ordre final.
    # Les UUID partagent un préfixe aléatoire et ont des suffixes croissants :
    # aucune collision entre runs, mais un ordre PostgreSQL prévisible.
    # dave : un message MAIS amitié non acceptée => ne doit PAS apparaître.
    id_base = uuid.uuid4().int & ~0xFFFF
    message_ids = [str(uuid.UUID(int=id_base + n)) for n in range(1, 7)]
    bob_old_id, bob_tie_low_id, bob_last_id, carol_old_id, carol_last_id, dave_id = message_ids
    sql(
        f"INSERT INTO messages (id, sender_id, receiver_id, content, created_at) VALUES "
        f"('{bob_old_id}','{a_id}','{b_id}','hey bob old', now() - interval '20 minutes'),"
        f"('{bob_tie_low_id}','{a_id}','{b_id}','bob tie low', now() - interval '1 minute'),"
        f"('{bob_last_id}','{b_id}','{a_id}','last from bob', now() - interval '1 minute'),"
        f"('{carol_old_id}','{c_id}','{a_id}','carol older', now() - interval '5 minutes'),"
        f"('{carol_last_id}','{a_id}','{c_id}','last to carol', now() - interval '1 minute'),"
        f"('{dave_id}','{d_id}','{a_id}','ghost dave', now() - interval '2 minutes');"
    )

    # --- Cas 2 & 3 : liste triée, lastMessage correct, dave absent ---------
    s.section("Cas 2/3 — conversations triées, partenaire correct, dave exclu")
    st, bd = req("GET", "/messages/conversations", a_tok)
    conv = bd.get("conversations", [])
    s.check("2. status 200", st, 200)
    s.check("2. exactement 2 conversations", len(conv), 2)
    ids = [c["friend"]["id"] for c in conv]
    s.check("3. dave (non-ami) absent", d_id not in ids, True)
    s.check("2. carol en premier (timestamp égal, id supérieur)", ids[0] if ids else None, c_id)
    s.check("2. bob en second", ids[1] if len(ids) > 1 else None, b_id)
    # lastMessage correct par ami
    first = conv[0] if conv else {}
    s.check("2. carol.lastMessage.id", first.get("lastMessage", {}).get("id"), carol_last_id)
    s.check("2. carol.lastMessage.content", first.get("lastMessage", {}).get("content"), "last to carol")
    s.check("2. carol.lastMessage.senderId == alice", first.get("lastMessage", {}).get("senderId"), a_id)
    s.check("2. carol.lastMessage.receiverId == carol", first.get("lastMessage", {}).get("receiverId"), c_id)
    s.check("2. carol.friend.pseudo", first.get("friend", {}).get("pseudo"), c_pseudo)
    second = conv[1] if len(conv) > 1 else {}
    s.check("2. bob.lastMessage.id départage le tie", second.get("lastMessage", {}).get("id"), bob_last_id)
    s.check("2. bob.lastMessage.content", second.get("lastMessage", {}).get("content"), "last from bob")
    s.check("2. bob.lastMessage.senderId == bob", second.get("lastMessage", {}).get("senderId"), b_id)
    s.check("2. bob.lastMessage.receiverId == alice", second.get("lastMessage", {}).get("receiverId"), a_id)
    # aucune fuite de champ sensible
    friend_keys = set(first.get("friend", {}).keys())
    s.check("2. friend keys exactes", friend_keys, {"id", "pseudo", "displayName", "avatarUrl"})
    lm_keys = set(first.get("lastMessage", {}).keys())
    s.check(
        "2. lastMessage keys exactes",
        lm_keys,
        {"id", "content", "senderId", "receiverId", "createdAt"},
    )
    raw = str(bd)
    s.check("2. pas d'email dans la réponse", "@t.io" not in raw, True)
    s.check("2. pas de password_hash/passwordHash", ("passwordHash" not in raw and "password_hash" not in raw), True)

    # Un deuxième appel doit produire exactement le même ordre.
    st, bd = req("GET", "/messages/conversations", a_tok)
    ids2 = [c["friend"]["id"] for c in bd.get("conversations", [])]
    s.check("3. ordre identique au 2e appel", ids2, ids)

    # --- Cas 4 : requests reçues (défaut), forme from: ---------------------
    s.section("Cas 4 — requests reçues (non-régression)")
    st, bd = req("GET", "/friends/requests", a_tok)
    reqs = bd.get("requests", [])
    s.check("4. status 200", st, 200)
    s.check("4. 1 demande reçue (dave)", len(reqs), 1)
    if reqs:
        s.check("4. clé 'from' présente", "from" in reqs[0], True)
        s.check("4. clé 'to' absente", "to" not in reqs[0], True)
        s.check("4. from.id == dave", reqs[0]["from"]["id"], d_id)
        s.check("4. keys top-level", set(reqs[0].keys()), {"id", "sentAt", "from"})

    # --- Cas 5 : requests envoyées, forme to: ------------------------------
    s.section("Cas 5 — requests envoyées")
    st, bd = req("GET", "/friends/requests?direction=sent", a_tok)
    reqs = bd.get("requests", [])
    s.check("5. status 200", st, 200)
    s.check("5. 1 demande envoyée (erin)", len(reqs), 1)
    if reqs:
        s.check("5. clé 'to' présente", "to" in reqs[0], True)
        s.check("5. clé 'from' absente", "from" not in reqs[0], True)
        s.check("5. to.id == erin", reqs[0]["to"]["id"], e_id)
        s.check("5. keys top-level", set(reqs[0].keys()), {"id", "sentAt", "to"})

    # --- Cas 6 : direction invalide -> 400 ---------------------------------
    s.section("Cas 6 — direction invalide")
    st, _ = req("GET", "/friends/requests?direction=xxx", a_tok)
    s.check("6. status 400", st, 400)

    # --- Cas 7 : annuler ma demande envoyée -> 200, disparaît --------------
    s.section("Cas 7 — annuler demande envoyée")
    st, _ = req("DELETE", f"/friends/{fs_ae}", a_tok)
    s.check("7. DELETE ma demande envoyée -> 200", st, 200)
    st, bd = req("GET", "/friends/requests?direction=sent", a_tok)
    s.check("7. plus de demande envoyée", len(bd.get("requests", [])), 0)

    # --- Cas 8 : unfriend accepté marche toujours (non-régression) ---------
    s.section("Cas 8 — unfriend accepté")
    st, _ = req("DELETE", f"/friends/{fs_ab}", a_tok)
    s.check("8. DELETE amitié acceptée -> 200", st, 200)
    st, bd = req("GET", "/friends", a_tok)
    friend_ids = [f["id"] for f in bd.get("friends", [])]
    s.check("8. bob n'est plus ami", b_id not in friend_ids, True)
    s.check("8. carol toujours amie", c_id in friend_ids, True)

    # --- Cas 9 : DELETE d'une pending REÇUE (je suis addressee) -> 400 -----
    s.section("Cas 9 — DELETE pending reçue interdit")
    st, _ = req("DELETE", f"/friends/{fs_da}", a_tok)
    s.check("9. status 400 (passer par reject)", st, 400)
    # la demande reçue est toujours là
    st, bd = req("GET", "/friends/requests", a_tok)
    s.check("9. demande reçue intacte", len(bd.get("requests", [])), 1)

    # --- Cas 10 : :id malformé -> 400 (pas 500) ----------------------------
    s.section("Cas 10 — :id malformé")
    st, _ = req("DELETE", "/friends/not-a-uuid", a_tok)
    s.check("10. status 400", st, 400)

    n_ok, n_ko = s.report()
    cleanup()
    return n_ok, n_ko


if __name__ == "__main__":
    ok, ko = run()
    sys.exit(1 if ko else 0)
