"""B5b — §5.2 lockout côté SOLO.

Le lockout ne peut pas se déclencher naturellement tant que B5c n'existe pas
(`started_at` n'est posé qu'à l'accept) → on force l'état en base pour le prouver.

La règle : seuls les matchs ACTIFS (in_progress / awaiting_confirmation / disputed)
verrouillent. Un match `completed` ou `cancelled` libère AUSSITÔT.
"""

from helpers import Suite, future, ladder_id, link, register, req, sql


def run():
    s = Suite("B5b — §5.2 lockout (solo)")

    tok, uid, pseudo = register("dave")
    link(tok, "chess_com")
    CHESS = ladder_id(tok, "chess", "1v1")

    st, b = req("POST", "/matches", tok, {"ladderId": CHESS, "scheduledAt": future()})
    M = b["match"]["id"]
    s.check("slot solo créé → 201", st, 201)

    # match ACTIF, démarré à l'instant → doit verrouiller
    sql(f"update matches set status='in_progress', started_at=now() where id='{M}';")
    st, b = req("POST", "/matches", tok, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("match in_progress récent → 409 lockout", st, 409, b.get("error", ""))

    # match TERMINÉ (même started_at récent) → ne doit PLUS verrouiller
    sql(f"update matches set status='completed' where id='{M}';")
    st, b = req("POST", "/matches", tok, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("match completed → 201 (libéré immédiatement)", st, 201, b.get("error", ""))
    M2 = b.get("match", {}).get("id")

    # on annule le nouveau slot pour repartir propre, puis on teste `cancelled`
    if M2:
        req("DELETE", f"/matches/{M2}", tok)
    sql(f"update matches set status='cancelled' where id='{M}';")
    st, b = req("POST", "/matches", tok, {"ladderId": CHESS, "scheduledAt": future()})
    s.check("match cancelled → 201 (libéré)", st, 201, b.get("error", ""))

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
