"""B5d — Le temps : grille horaire, fenêtres de disponibilité, expiration des slots.

Ce que ce ticket a changé, et que cette suite doit prouver :

  1. GRILLE — `scheduled_at` doit tomber sur un quart fixe (:00/:15/:30/:45) et être
     à >= 15 min dans le futur. Vaut pour CRÉER et pour ACCEPTER.

  2. FENÊTRES — chaque match occupe [scheduled_at, scheduled_at + lockout_minutes].
     Un camp ne peut pas avoir deux matchs dont les fenêtres se CHEVAUCHENT.
     ⚠️ Inégalités STRICTES : deux fenêtres qui se TOUCHENT (21h–22h puis 22h–23h)
     ne se chevauchent pas → l'enchaînement dos à dos est AUTORISÉ.
     C'est le cas d'usage central : « je planifie ma soirée » (21h / 23h / 01h).

  3. OPTION A RESSERRÉE — accepter un match n'annule QUE les slots qui chevauchent.
     Les autres (23h, 01h) doivent SURVIVRE. Avant B5d, tous tombaient.

  4. EXPIRATION — un slot pending sous la barre des 15 min est périmé : masqué de la
     liste, refusé à l'accept, ignoré par le check de conflit et par le plafond,
     et passé à `cancelled` par le job.

  5. PLAFOND — 5 slots ouverts max par camp et par ladder.

  6. NON-RÉGRESSION — c'est `scheduled_at`, et NON `started_at`, qui pilote la
     disponibilité. On force `started_at` loin dans le passé (l'ancien lockout serait
     expiré) et on vérifie qu'un slot chevauchant reste refusé. LE test qui verrouille
     le changement de modèle de B5d.

  7. LONGUEUR DE FENÊTRE — elle se lit sur le ladder (`lockout_minutes`), pas câblée à
     30 : sur val 5v5 (lockout 60) la fenêtre vaut bien 60 min.

⚠️ Les heures sont calculées en UTC et alignées sur le quart, comme l'exige le back.
"""

import time
import uuid
from datetime import datetime, timedelta, timezone

from helpers import Suite, join_team, ladder_id, link, register, req, sql

MIN_LEAD_MINUTES = 15
MAX_OPEN_SLOTS = 5


def slot(minutes_from_now):
    """Une heure alignée sur le quart, au moins `minutes_from_now` dans le futur.

    On arrondit AU QUART SUPÉRIEUR : le back refuse tout ce qui n'est pas :00/:15/:30/:45.
    """
    t = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    t = t.replace(second=0, microsecond=0)
    t += timedelta(minutes=(15 - t.minute % 15) % 15)
    if t <= datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now):
        t += timedelta(minutes=15)
    return t


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def create(token, ladder, when):
    return req("POST", "/matches", token, {"ladderId": ladder, "scheduledAt": iso(when)})


def status_of(match):
    return sql(f"select status from matches where id='{match}';")


def run():
    s = Suite("B5d — grille horaire, fenêtres, expiration")

    tokA, idA, _ = register("alice")
    tokB, idB, _ = register("bob")
    tokC, idC, _ = register("carol")

    CHESS = ladder_id(tokA, "chess", "1v1")  # 1v1 → lockout 30 min
    for t in (tokA, tokB, tokC):
        link(t, "chess_com")

    LOCKOUT = int(sql(f"select lockout_minutes from ladders where id='{CHESS}';"))
    s.check("le ladder chess a bien un lockout de 30 min", LOCKOUT, 30)

    # ─────────────────────────────────────────── 1. LA GRILLE
    s.section("Grille horaire — quart fixe + 15 min d'avance")

    base = slot(120)  # une heure ronde bien dans le futur

    st, b = create(tokA, CHESS, base)
    M_BASE = b.get("match", {}).get("id")
    s.check("heure alignée sur le quart, 2h à l'avance → 201", st, 201, b.get("error", ""))

    st, b = req(
        "POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": iso(base + timedelta(minutes=7))}
    )
    s.check("21h07 (hors quart) → 400", st, 400)

    st, b = req(
        "POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": iso(base + timedelta(seconds=30))}
    )
    s.check("21h00:30 (secondes non nulles) → 400", st, 400)

    # « Sur un quart mais à moins de 15 min » doit TOUJOURS être refusé (400).
    # Le prochain quart est à < 15 min dans TOUS les cas, sauf à l'instant (de mesure
    # nulle) où l'on est posé pile sur un quart : il tombe alors à +15 min exactement,
    # borne incluse → accepté. On s'écarte de ce cas-limite pour que l'assertion
    # s'exécute réellement à chaque run. ⚠️ L'ancienne version avait une branche
    # « non testable » qui se déclarait VERTE sans appeler l'API — un faux test.
    def next_quarter():
        n = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        q = n + timedelta(minutes=(15 - n.minute % 15) % 15)
        if q <= datetime.now(timezone.utc):
            q += timedelta(minutes=15)
        return q

    q = next_quarter()
    if (q - datetime.now(timezone.utc)).total_seconds() >= MIN_LEAD_MINUTES * 60:
        time.sleep(2)  # posé pile sur un quart : on s'en écarte pour retomber sous 15 min
        q = next_quarter()
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": iso(q)})
    s.check("prochain quart à < 15 min du coup d'envoi → 400", st, 400, b.get("error", ""))

    st, b = req(
        "POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": iso(base - timedelta(days=1))}
    )
    s.check("heure dans le PASSÉ → 400", st, 400)

    # ─────────────────────────────────────────── 2. LES FENÊTRES
    s.section("Fenêtres — chevauchement interdit, mais dos à dos AUTORISÉ")

    # alice a déjà M_BASE à `base` → sa fenêtre est [base, base+30]
    st, b = create(tokA, CHESS, base + timedelta(minutes=15))
    s.check("slot à base+15 (chevauche [base, base+30]) → 409", st, 409, b.get("error", ""))

    st, b = create(tokA, CHESS, base - timedelta(minutes=15))
    s.check("slot à base−15 (chevauche aussi) → 409", st, 409, b.get("error", ""))

    st, b = create(tokA, CHESS, base + timedelta(minutes=30))
    M_BACK2BACK = b.get("match", {}).get("id")
    s.check(
        "🔑 slot à base+30 : les fenêtres se TOUCHENT → 201 (dos à dos autorisé)",
        st,
        201,
        b.get("error", ""),
    )

    st, b = create(tokA, CHESS, base - timedelta(minutes=30))
    M_BEFORE = b.get("match", {}).get("id")
    s.check("🔑 slot à base−30 : se touchent aussi → 201", st, 201, b.get("error", ""))

    s.section("Soirée gaming — plusieurs slots espacés coexistent")
    st, b = create(tokA, CHESS, base + timedelta(hours=2))
    M_LATE = b.get("match", {}).get("id")
    s.check("slot 2h plus tard → 201", st, 201, b.get("error", ""))

    open_slots = sql(
        "select count(*) from matches m "
        "join match_sides s on s.match_id = m.id "
        "join match_participants p on p.match_side_id = s.id "
        f"where p.user_id = '{idA}' and m.status = 'pending';"
    )
    s.check("alice a bien 4 slots ouverts en parallèle", open_slots, "4")

    # ─────────────────────────────────────────── 3. PLAFOND
    s.section(f"Plafond — {MAX_OPEN_SLOTS} slots ouverts maximum")

    st, b = create(tokA, CHESS, base + timedelta(hours=4))
    s.check("5e slot → 201", st, 201, b.get("error", ""))
    st, b = create(tokA, CHESS, base + timedelta(hours=6))
    s.check(f"6e slot → 409 (plafond de {MAX_OPEN_SLOTS})", st, 409, b.get("error", ""))

    # ─────────────────────────────────────────── 4. ACCEPT
    # ⚠️ LA DISTINCTION CLÉ DU TICKET :
    #   - un match ACTIF qui chevauche → l'accept est REFUSÉ (je jouerais deux matchs)
    #   - un slot PENDING qui chevauche → l'accept PASSE, et le slot est RETIRÉ (option A).
    #     Un slot n'est qu'une PROPOSITION : m'engager pour de bon la rend caduque.
    #     La compter comme un blocage me refuserait un match à cause d'une offre que je
    #     m'apprête moi-même à annuler.
    s.section("Accept — un slot PENDING qui chevauche ne bloque pas : il est RETIRÉ")

    st, b = create(tokB, CHESS, base + timedelta(minutes=15))
    M_BOB = b.get("match", {}).get("id")
    s.check("bob ouvre un slot à base+15 (chevauche `base`) → 201", st, 201, b.get("error", ""))

    st, b = req("POST", f"/matches/{M_BASE}/accept", tokB)
    s.check(
        "🔑 bob accepte le slot d'alice à `base` malgré SON slot qui chevauche → 200",
        st,
        200,
        b.get("error", ""),
    )
    s.check("… et son slot chevauchant a été RETIRÉ (option A)", status_of(M_BOB), "cancelled")

    s.section("🔑 Option A resserrée — seuls les slots qui CHEVAUCHENT tombent")
    s.check("le match accepté est in_progress", status_of(M_BASE), "in_progress")
    s.check("le slot d'alice à base−30 (se touche) SURVIT", status_of(M_BEFORE), "pending")
    s.check("le slot d'alice à base+30 (se touche) SURVIT", status_of(M_BACK2BACK), "pending")
    s.check("le slot d'alice 2h plus tard SURVIT", status_of(M_LATE), "pending")

    s.section("Accept — un match ACTIF, lui, BLOQUE bien")
    # bob est maintenant dans un match ACTIF sur [base, base+30].
    st, b = create(tokB, CHESS, base + timedelta(minutes=15))
    s.check("bob (en match ACTIF) ouvre un slot qui chevauche → 409", st, 409, b.get("error", ""))
    st, b = create(tokB, CHESS, base + timedelta(minutes=30))
    s.check("bob ouvre un slot dos à dos (base+30) → 201", st, 201, b.get("error", ""))

    # carol crée un slot qui chevauche le match ACTIF de bob → bob ne pourra pas l'accepter
    st, b = create(tokC, CHESS, base + timedelta(minutes=15))
    M_CAROL = b.get("match", {}).get("id")
    s.check("carol ouvre un slot à base+15 → 201", st, 201, b.get("error", ""))
    st, b = req("POST", f"/matches/{M_CAROL}/accept", tokB)
    s.check(
        "bob accepte un match qui chevauche son match ACTIF → 409",
        st,
        409,
        b.get("error", ""),
    )

    # ─────────────────────────────────────────── 5. EXPIRATION
    s.section("Expiration — un slot sous les 15 min est mort")

    # On force un slot d'alice juste sous la barre (l'API refuserait de le créer ainsi).
    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    sql(f"update matches set scheduled_at = '{soon.isoformat()}' where id='{M_LATE}';")

    st, b = req("GET", f"/matches?ladderId={CHESS}", tokB)
    listed = [x["id"] for x in b.get("slots", [])]
    s.check("le slot périmé est MASQUÉ de la liste", M_LATE in listed, False)

    st, b = req("POST", f"/matches/{M_LATE}/accept", tokB)
    s.check("accepter un slot périmé → 409", st, 409, b.get("error", ""))

    # le slot périmé ne doit PLUS bloquer alice : il ne compte ni dans le conflit,
    # ni dans le plafond. Elle était à 5 slots ; l'un est mort → elle peut en rouvrir un.
    # ⚠️ `base` est aligné sur le quart — repartir de `soon` (non aligné) donnerait un 400.
    st, b = create(tokA, CHESS, base + timedelta(hours=8))
    s.check(
        "un slot périmé ne consomme plus d'emplacement (alice peut rouvrir)",
        st,
        201,
        b.get("error", ""),
    )

    # On enchaîne le test du job DIRECTEMENT sur l'expiration, sans aucune inscription
    # entre-deux : le moindre `register` peut coûter ~60 s de rate-limit, pendant lesquelles
    # le job (qui tourne à la minute) annulerait déjà le slot. On NE teste donc PAS
    # « encore pending avant le job » — c'est une propriété fragile (« le job n'a pas encore
    # tourné »), pas un invariant. Seule compte la garantie utile : il FINIT par l'annuler.
    s.section("Le job d'expiration annule les slots morts")
    print("   ⏳ attente du job (passe à la minute)…")
    for _ in range(75):
        if status_of(M_LATE) == "cancelled":
            break
        time.sleep(1)
    s.check("le job a passé le slot périmé à `cancelled`", status_of(M_LATE), "cancelled")

    # ─────────────────────────────────────────── 6. NON-RÉGRESSION
    # LE test qui verrouille B5d : prouver que c'est `scheduled_at`, et NON `started_at`,
    # qui pilote la disponibilité. On monte un match ACTIF puis on repousse son
    # `started_at` très loin dans le PASSÉ :
    #   - ancien modèle (lockout = started_at + lockout_minutes) → EXPIRÉ → « libre »
    #   - nouveau modèle (fenêtre sur scheduled_at) → toujours OCCUPÉ sur [T, T+30]
    # Un slot chevauchant DOIT donc être refusé. Si quelqu'un réintroduit `started_at`
    # dans le check, ce test repasse au vert côté création → régression attrapée.
    s.section("Non-régression — scheduled_at pilote la dispo, PAS started_at")

    tokD, idD, _ = register("dave")
    tokE, idE, _ = register("erin")
    link(tokD, "chess_com")
    link(tokE, "chess_com")

    T = slot(300)  # 5 h dans le futur, loin de tout le reste de la suite
    st, b = create(tokD, CHESS, T)
    M_NR = b.get("match", {}).get("id")
    s.check("dave ouvre un slot à T → 201", st, 201, b.get("error", ""))

    st, b = req("POST", f"/matches/{M_NR}/accept", tokE)
    s.check("erin l'accepte → match ACTIF sur [T, T+30] → 200", st, 200, b.get("error", ""))

    sql(f"update matches set started_at = now() - interval '10 hours' where id='{M_NR}';")
    s.check("started_at forcé 10 h dans le passé (l'ancien lockout serait EXPIRÉ)", status_of(M_NR), "in_progress")

    st, b = create(tokD, CHESS, T + timedelta(minutes=15))
    s.check(
        "🔑 slot chevauchant REFUSÉ malgré started_at périmé → 409 "
        "(c'est bien scheduled_at qui pilote)",
        st,
        409,
        b.get("error", ""),
    )
    st, b = create(tokD, CHESS, T + timedelta(minutes=30))
    s.check("… et le dos à dos (T+30) passe → 201 (fenêtre = 30 min, pas 0)", st, 201, b.get("error", ""))

    # ─────────────────────────────────────────── 7. FENÊTRE 5v5 = 60 MIN
    # La longueur de fenêtre se LIT sur le ladder (lockout_minutes), elle n'est pas
    # câblée à 30. Sur un ladder 5v5 (val, lockout 60), la fenêtre doit valoir 60 min :
    # un slot à +45 chevauche, un slot à +60 est dos à dos.
    s.section("Fenêtre 5v5 — la durée vient du ladder (val 5v5 = 60 min)")

    VAL5 = ladder_id(tokA, "val", "5v5")
    for t in (tokA, tokB, tokC, tokD, tokE):
        link(t, "riot")  # val exige un compte riot (§5.1)

    st, b = req("POST", "/teams", tokA, {"ladderId": VAL5, "name": f"alpha{uuid.uuid4().hex[:6]}"})
    TEAM = b.get("team", {}).get("id") or b.get("id")
    s.check("alice crée une team sur val 5v5 → 201", st, 201, b.get("error", ""))
    for uid in (idB, idC, idD, idE):
        join_team(TEAM, uid)

    LINEUP = [idA, idB, idC, idD, idE]
    U = slot(500)  # loin de tout, aligné quart
    st, b = req("POST", "/matches", tokA, {"ladderId": VAL5, "scheduledAt": iso(U), "lineup": LINEUP})
    s.check("slot 5v5 à U → 201", st, 201, b.get("error", ""))

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL5, "scheduledAt": iso(U + timedelta(minutes=45)), "lineup": LINEUP})
    s.check("slot à U+45 (chevauche la fenêtre de 60 min) → 409", st, 409, b.get("error", ""))

    st, b = req("POST", "/matches", tokA, {"ladderId": VAL5, "scheduledAt": iso(U + timedelta(minutes=60)), "lineup": LINEUP})
    s.check("🔑 slot à U+60 (dos à dos, fenêtre = 60 min) → 201", st, 201, b.get("error", ""))

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
