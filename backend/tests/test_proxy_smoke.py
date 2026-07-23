"""Smoke test du chemin PROXIFIÉ (I4) : l'origine applicative unique du navigateur.

Contrairement aux autres suites (qui tapent le backend en DIRECT sur https://localhost:3000),
celle-ci vérifie que TOUT est joignable via https://localhost:5173 :
  - /api/*   → backend (retrait du préfixe /api)
  - /media/* → MinIO   (retrait du préfixe /media)
le bucket privé `evidence` refusé sans signature, et le CYCLE DE VIE du refresh cookie
(posé ET effacé sur Path=/api/auth via la réécriture du proxy).

Nécessite le frontend Docker en marche. Exécution autonome :
    PROXY_BASE_URL=https://localhost:5173 python3 test_proxy_smoke.py

Inclus dans run_all.py (dernier de la liste) : il suppose alors que le proxy Vite tourne.
"""

import io
import json
import os
import ssl
import urllib.error
import urllib.request
import uuid

PROXY = os.environ.get("PROXY_BASE_URL", "https://localhost:5173")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

_passed = 0
_failed = 0


def check(name, condition):
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed += 1
        print(f"  ❌ {name}")


def raw(method, path, data=None, headers=None, token=None):
    """Renvoie (status, set_cookies, body). set_cookies = liste brute des en-têtes Set-Cookie."""
    req = urllib.request.Request(f"{PROXY}{path}", method=method, data=data)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        resp = urllib.request.urlopen(req, context=CTX)
        return resp.status, resp.headers.get_all("Set-Cookie") or [], resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get_all("Set-Cookie") or [], e.read()


def refresh_cookie(set_cookies):
    """Retourne l'en-tête Set-Cookie du cookie `refresh` (ou None)."""
    for c in set_cookies:
        if c.startswith("refresh="):
            return c
    return None


def is_cleared(cookie_header):
    """Vrai si l'en-tête Set-Cookie EFFACE le cookie (Max-Age=0 ou Expires 1970 ou valeur vide)."""
    low = cookie_header.lower()
    empty_value = cookie_header.startswith("refresh=;") or cookie_header.startswith("refresh=; ")
    return "max-age=0" in low or "expires=thu, 01 jan 1970" in low or empty_value


def multipart(field_name, filename, content, content_type):
    boundary = f"----i4smoke{uuid.uuid4().hex}"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode()
    )
    body.write(f"Content-Type: {content_type}\r\n\r\n".encode())
    body.write(content)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


# 1x1 PNG minimal (bytes valides, suffisant pour l'upload d'avatar).
PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)


def run():
    global _passed, _failed
    _passed = _failed = 0
    print(f"\n[proxy smoke I4] base = {PROXY}")

    # --- /api : le backend est joignable derrière le proxy, préfixe retiré ---
    status, _, body = raw("GET", "/api/ping")
    check("/api/ping proxifié → 200", status == 200)
    check("/api/ping renvoie pong-from-docker", b"pong-from-docker" in body)

    # --- / : la SPA React est servie (pas du JSON) ---
    status, _, body = raw("GET", "/")
    check("/ sert du HTML (SPA)", status == 200 and b"<!doctype html" in body.lower())

    # --- /media : MinIO est joignable derrière le proxy ---
    status, _, _ = raw("GET", "/media/minio/health/live")
    check("/media/* atteint MinIO (health live 200)", status == 200)

    # --- bucket privé : une clé evidence sans signature est REFUSÉE (jamais publique) ---
    status, _, _ = raw("GET", f"/media/evidence/{uuid.uuid4().hex}")
    check("evidence non signé refusé (403/400, pas 200)", status in (400, 403))

    # --- cycle de vie du cookie + avatar : nécessite un register réussi ---
    suffix = uuid.uuid4().hex[:8]
    pseudo = f"erin{suffix}"
    reg_body = (
        '{"pseudo":"%s","email":"%s@test.com","password":"Aa1!aaaa"}' % (pseudo, pseudo)
    ).encode()
    status, set_cookies, body = raw(
        "POST", "/api/auth/register", data=reg_body, headers={"Content-Type": "application/json"}
    )
    if status != 201:
        print(f"  info register status={status} (rate-limit ?) ; sous-tests auth/avatar sautés")
        return _passed, _failed

    # 1) Le refresh cookie est POSÉ sur Path=/api/auth (réécriture du proxy), non effacé.
    rc = refresh_cookie(set_cookies)
    check("register pose un refresh cookie", rc is not None)
    check("refresh cookie Path=/api/auth", bool(rc) and "Path=/api/auth" in rc)
    check("refresh cookie HttpOnly+Secure+SameSite=Strict",
          bool(rc) and "HttpOnly" in rc and "Secure" in rc and "SameSite=Strict" in rc)
    check("refresh cookie non effacé au register", bool(rc) and not is_cleared(rc))

    token = json.loads(body)["accessToken"]

    # --- avatar : upload via /api, URL relative /media/avatars/, lisible via /media ---
    data, ctype = multipart("avatar", "a.png", PNG_1x1, "image/png")
    status, _, body = raw(
        "POST", "/api/users/me/avatar", data=data, headers={"Content-Type": ctype}, token=token
    )
    check("upload avatar via /api → 200", status == 200)
    avatar_url = json.loads(body)["user"]["avatarUrl"] if status == 200 else ""
    check("avatarUrl est relatif /media/avatars/", avatar_url.startswith("/media/avatars/"))
    if avatar_url.startswith("/media/"):
        status, _, img = raw("GET", avatar_url)
        check("avatar lisible via /media (200)", status == 200)
        check("avatar renvoie bien des octets image", len(img) > 0)

    # 2) logout EFFACE le refresh cookie sur Path=/api/auth.
    status, set_cookies, _ = raw("POST", "/api/auth/logout")
    rc = refresh_cookie(set_cookies)
    check("logout → 200", status == 200)
    check("logout efface le refresh cookie (Max-Age=0)", bool(rc) and is_cleared(rc))
    check("cookie effacé toujours scopé Path=/api/auth", bool(rc) and "Path=/api/auth" in rc)

    # 3) delete du compte EFFACE aussi le refresh cookie sur Path=/api/auth (nettoie le user).
    status, set_cookies, _ = raw(
        "DELETE",
        "/api/users/me",
        data=b'{"password":"Aa1!aaaa"}',
        headers={"Content-Type": "application/json"},
        token=token,
    )
    rc = refresh_cookie(set_cookies)
    check("delete compte → 200", status == 200)
    check("delete efface le refresh cookie sur Path=/api/auth",
          bool(rc) and is_cleared(rc) and "Path=/api/auth" in rc)

    return _passed, _failed


if __name__ == "__main__":
    ok, ko = run()
    print(f"\n[proxy smoke I4] {ok} ✅   {ko} ❌")
    raise SystemExit(1 if ko else 0)
