"""Lance toutes les suites end-to-end et nettoie la base de test à la fin.

    cd backend/tests && python3 run_all.py

Prérequis : `docker compose up -d` + migrations passées.
"""

import sys

from helpers import cleanup, req

import test_sentinel
import test_matches_create
import test_matches_lockout
import test_matches_cancel
import test_matches_accept
import test_matches_me
import test_matches_detail
import test_matches_concurrency
import test_matches_scheduling
import test_matches_result
import test_teams_linked
import test_teams_invitations
import test_teams_logo
import test_teams_matches
import test_disputes
import test_notifications
import test_search
import test_social_data
import test_users_deletion
import test_proxy_smoke
import test_auth_contract

SUITES = [
    test_matches_create,
    test_matches_lockout,
    test_matches_cancel,
    test_matches_accept,
    test_matches_me,
    test_matches_detail,
    test_matches_concurrency,
    test_matches_scheduling,
    test_matches_result,
    test_teams_linked,
    test_teams_invitations,
    test_teams_logo,
    test_teams_matches,
    test_disputes,
    test_notifications,
    test_search,
    test_social_data,
    # Supprime des comptes : la placer APRÈS les suites qui inspectent des users partagés.
    test_users_deletion,
    # Dernier : suppose le proxy Vite (https://localhost:5173) en marche. Valide la topologie I4
    # proxifiée (/api, /media, cycle de vie du refresh cookie). Surchargeable via PROXY_BASE_URL.
    test_proxy_smoke,
    # Dernière : elle SATURE volontairement les quotas de register et login pour en tester les
    # 429. Aucune autre suite n'utilise ces routes, mais la placer en fin de run garantit que
    # ça reste vrai même si quelqu'un en ajoute une.
    test_auth_contract,
]


def main():
    # 429 = joignable aussi : `test_auth_contract` sature volontairement le compteur anonyme
    # pour prouver le repli par IP, et il reste vide ~1 min. Sans ce cas, un run relancé dans
    # la foulée sortirait sur un « backend injoignable » parfaitement faux.
    status, _ = req("GET", "/ping")
    if status not in (200, 429):
        sys.exit("❌ backend injoignable sur https://localhost:3000 — `docker compose up -d` ?")

    cleanup()  # on part d'une base sans résidus d'un run précédent

    # SENTINELLE, avant tout le reste et hors de la boucle : elle vérifie que le token forgé
    # par `helpers.forge_token()` est toujours accepté. Si elle tombe, enchaîner 17 suites ne
    # produirait que du bruit — des centaines de 401 pour un problème d'OUTILLAGE. On s'arrête
    # net, avec le bon diagnostic, à la première seconde du run.
    total_ok, total_ko = test_sentinel.run()
    if total_ko:
        cleanup()
        sys.exit(
            "\n❌ SENTINELLE KO — helpers.forge_token() a dérivé de backend/src/auth/tokens.ts "
            "(algo, secret JWT_SECRET, claim type:'access'). Run interrompu : corrige le helper."
        )

    try:
        for suite in SUITES:
            ok, ko = suite.run()
            total_ok += ok
            total_ko += ko
    finally:
        cleanup()

    print(f"\n{'=' * 66}")
    print(f"  TOTAL : {total_ok} ✅   {total_ko} ❌")
    print(f"{'=' * 66}")
    sys.exit(1 if total_ko else 0)


if __name__ == "__main__":
    main()
