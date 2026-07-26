"""SENTINELLE — le token forgé par `helpers.py` est-il toujours accepté par le backend ?

`helpers.register()` ne passe plus par `POST /auth/register` : il insère l'user en SQL et
SIGNE LUI-MÊME l'access token. Ça supprime ~15 min d'attente par run (la route est à 3/min
par IP, et elle le reste — rien n'a été désactivé côté serveur). Le prix à payer est un
COUPLAGE : `helpers.forge_token()` duplique la forme du token de `backend/src/auth/tokens.ts`
(HS256, secret `JWT_SECRET`, claim `type: 'access'`).

Si ce couplage dérive — nouveau claim, autre algo, autre secret — les suites tombent en 401
et le diagnostic devient « tout est cassé ». Cette suite tourne DONC EN PREMIER, et un échec
ici ARRÊTE le run immédiatement avec le bon message.

Elle vérifie aussi la RÉCIPROQUE : un token bricolé doit être REFUSÉ. Sans ces trois cas, un
backend qui accepterait n'importe quoi passerait la sentinelle au vert — elle ne prouverait
alors plus rien.

⚠️ Cette suite valide la forme du TOKEN. L'équivalence de l'USER semé (mêmes colonnes, mêmes
effets de bord qu'une vraie inscription) est vérifiée dans `test_auth_contract.py`.
"""

from helpers import Suite, forge_token, register, req


def run():
    s = Suite("SENTINELLE — le token forgé par helpers.py est-il valide ?")

    tok, uid, pseudo = register("alice")

    s.section("Le token forgé ouvre bien une route authentifiée")
    st, b = req("GET", "/users/me", tok)
    s.check(
        "GET /users/me avec un token forgé → 200",
        st,
        200,
        "⚠️ si ce cas est rouge : helpers.forge_token() a dérivé de backend/src/auth/tokens.ts "
        "(algo, secret JWT_SECRET, claim type:'access') — corrige le helper, pas les suites.",
    )
    # Prouve que le token porte le BON sub, et que la ligne semée en SQL est bien celle-là :
    # un token valide pointant sur un autre user rendrait toutes les suites incohérentes.
    s.check("le token pointe sur l'user semé (sub)", (b.get("user") or {}).get("id"), uid)
    s.check("la ligne semée en SQL est celle lue par l'API", (b.get("user") or {}).get("pseudo"), pseudo)
    s.check("projection : pas de passwordHash", "passwordHash" in (b.get("user") or {}), False)

    s.section("Réciproque — un token bricolé DOIT être refusé")
    st, _ = req("GET", "/users/me", forge_token(uid, secret="mauvais-secret"))
    s.check("signature invalide → 401", st, 401)
    st, _ = req("GET", "/users/me", forge_token(uid, kind="refresh"))
    s.check("type 'refresh' → 401 (invariant : seul un access ouvre les routes)", st, 401)
    st, _ = req("GET", "/users/me", forge_token(uid, ttl=-60))
    s.check("token expiré → 401", st, 401)

    return s.report()


if __name__ == "__main__":
    run()
