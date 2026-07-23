"""Lance toutes les suites end-to-end et nettoie la base de test à la fin.

    cd backend/tests && python3 run_all.py

Prérequis : `docker compose up -d` + migrations passées.
"""

import sys

from helpers import cleanup, req

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
import test_disputes
import test_notifications
import test_search
import test_proxy_smoke

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
    test_disputes,
    test_notifications,
    test_search,
    # Dernier : suppose le proxy Vite (https://localhost:5173) en marche. Valide la topologie I4
    # proxifiée (/api, /media, cycle de vie du refresh cookie). Surchargeable via PROXY_BASE_URL.
    test_proxy_smoke,
]


def main():
    status, _ = req("GET", "/ping")
    if status != 200:
        sys.exit("❌ backend injoignable sur https://localhost:3000 — `docker compose up -d` ?")

    cleanup()  # on part d'une base sans résidus d'un run précédent

    total_ok = total_ko = 0
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
