"""Outils partagés par les suites de tests end-to-end.

Les tests tapent sur le vrai backend (HTTPS, cert auto-signé) et sur la vraie base
de dev. Ils créent leurs propres utilisateurs (préfixés + suffixe hexa) et les
nettoient à la fin : les données de l'équipe ne sont jamais touchées.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import ssl
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = os.environ.get("TEST_BASE_URL", "https://localhost:3000")

# Racine du repo, déduite de l'emplacement de CE fichier (backend/tests/helpers.py) :
# tests → backend → racine. Surtout PAS de chemin en dur : les tests doivent tourner
# chez n'importe quel coéquipier, dans n'importe quel dossier.
ROOT = str(Path(__file__).resolve().parents[2])

# cert auto-signé en dev → on ne vérifie pas la chaîne
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# les users de test portent ce motif : on ne nettoiera QUE ceux-là
TEST_USER_RE = r"^(alice|bob|carol|dave|erin)[0-9a-f]{8}$"


# ---------------------------------------------------------------- HTTP
def req(method, path, token=None, body=None):
    """Renvoie (status, json). Pas de Content-Type sans body : Fastify renverrait
    400 FST_ERR_CTP_EMPTY_JSON_BODY (piège classique sur les DELETE)."""
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            return resp.status, _parse(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read().decode())


def req_multipart(method, path, token=None, files=(), fields=()):
    """Comme `req()`, mais en **multipart/form-data** — `req()` n'encode que du JSON.

    `files`  : itérable de (fieldname, filename, contenu_bytes, mimetype)
    `fields` : itérable de (fieldname, valeur_str)

    Renvoie (status, json). Résilient : si le serveur coupe la connexion en cours d'envoi
    (fichier rejeté avant la fin du corps), on renvoie (-1, ...) plutôt que de crasher.
    Sert aux uploads d'avatar, de logo d'équipe et de preuve de dispute.
    """
    boundary = "----b" + uuid.uuid4().hex
    body = b""
    for fieldname, filename, content, mimetype in files:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{fieldname}"; filename="{filename}"\r\n'
            f"Content-Type: {mimetype}\r\n\r\n"
        ).encode() + content + b"\r\n"
    for fieldname, value in fields:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{fieldname}"\r\n\r\n{value}\r\n'
        ).encode()
    body += f"--{boundary}--\r\n".encode()

    r = urllib.request.Request(BASE + path, data=body, method=method)
    r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            return resp.status, _parse(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read().decode())
    except (urllib.error.URLError, OSError):
        return -1, {"raw": "connection aborted"}


def _parse(raw):
    """Toutes les routes ne renvoient pas du JSON (ex. /ping renvoie du texte)."""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


# Mot de passe unique des users de test, et son hash bcrypt figé. Le COST 12 est celui de
# `hashPassword()` (backend/src/auth/password.ts) : un user semé en SQL est ainsi
# INDISCERNABLE d'un user inscrit par l'API, jusqu'au coût de vérification. Sa capacité à se
# logger et son équivalence colonne par colonne sont vérifiées par `test_auth_contract.py`.
# Régénérer avec (aligner le cost sur celui de hashPassword) :
#   docker compose exec backend node -e "console.log(require('bcryptjs').hashSync('Test1234!',12))"
FIXTURE_PASSWORD = "Test1234!"
FIXTURE_HASH = "$2b$12$fw2ngYMEiBbg5XgJkTG4.ujHTa5M0g3FrITvdpTtzqVKxp8aPnuI."

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def forge_token(sub, kind="access", ttl=900, secret=None):
    """Forge un JWT identique à ceux de `signAccessToken` (backend/src/auth/tokens.ts).

    ⚠️ COUPLAGE ASSUMÉ, ET SURVEILLÉ : HS256, secret `JWT_SECRET`, claims
    `{sub, type, iat, exp}`, TTL 15 min. Si `tokens.ts` change, c'est `test_sentinel.py`
    qui le dit — en une seconde, au tout début du run, et non à travers 17 suites rouges.

    `kind`, `ttl` et `secret` ne servent qu'à la sentinelle, pour forger les tokens qui
    doivent être REFUSÉS (mauvais type, expiré, mauvaise signature).
    """

    def seg(obj):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    now = int(time.time())
    key = (secret if secret is not None else _env("JWT_SECRET")).encode()
    msg = seg({"alg": "HS256", "typ": "JWT"}) + b"." + seg(
        {"sub": sub, "type": kind, "iat": now, "exp": now + ttl}
    )
    sig = base64.urlsafe_b64encode(hmac.new(key, msg, hashlib.sha256).digest()).rstrip(b"=")
    return (msg + b"." + sig).decode()


def register(tag):
    """Crée un user de test **directement en base**, et forge son access token.

    Pourquoi pas `POST /auth/register` ? Parce que la route est rate-limitée à 3/min par IP,
    et qu'elle le RESTE : rien n'est désactivé ni configuré côté serveur, un checkout propre
    reste strict, et il n'existe aucun interrupteur pour l'affaiblir. Les suites créent des
    dizaines d'users : passer par la route coûtait ~15 min d'attente par run, à chaque
    itération du codeur PUIS du reviewer.

    Le contrat de la route est couvert, lui, par `test_auth_contract.py`, qui l'appelle pour
    de vrai — 429 compris — et qui vérifie que l'user semé ici est ÉQUIVALENT à un user
    inscrit par l'API (mêmes colonnes, mêmes effets de bord dans les autres tables).

    Renvoie le même triplet qu'avant — `(token, id, pseudo)` : aucune suite ne change.
    """
    u = uuid.uuid4().hex[:8]
    pseudo = f"{tag}{u}"
    uid = sql(
        "insert into users (pseudo, email, password_hash) values "
        f"('{pseudo}', '{pseudo}@t.io', '{FIXTURE_HASH}') returning id;"
    )
    # Garde-fou : un insert refusé rend "" (ou du bruit) → on s'arrête AVEC la cause, plutôt
    # que de forger un token sur un sub invalide et de voir 17 suites tomber en 401.
    if not _UUID_RE.match(uid):
        raise SystemExit(f"seed de l'user {pseudo} : insert inattendu → {uid!r}")
    return forge_token(uid), uid, pseudo


def link(token, provider):
    return req("POST", "/users/me/external-accounts", token, {"provider": provider, "externalId": uuid.uuid4().hex[:8]})


def ladders(token):
    _, b = req("GET", "/ladders", token)
    return b["ladders"] if isinstance(b, dict) and "ladders" in b else b


def ladder_id(token, game, fmt):
    for l in ladders(token):
        if l["gameId"] == game and l["format"] == fmt:
            return l["id"]
    raise SystemExit(f"ladder {game} {fmt} introuvable — les migrations sont-elles passées ?")


def future(hours=1):
    """Une heure de match VALIDE : alignée sur le quart (:00/:15/:30/:45) et dans le futur.

    ⚠️ Depuis B5d, le back refuse toute heure hors quart fixe (400) et à moins de 15 min
    du coup d'envoi. Ce helper arrondit donc AU QUART SUPÉRIEUR — sans quoi toutes les
    suites qui créent des matchs se prendraient un 400.
    """
    t = datetime.now(timezone.utc) + timedelta(hours=hours)
    t = t.replace(second=0, microsecond=0)
    t += timedelta(minutes=(15 - t.minute % 15) % 15)  # arrondi au quart supérieur
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def past():
    """Une heure passée, alignée sur le quart — pour tester le rejet des dates passées."""
    t = datetime.now(timezone.utc) - timedelta(hours=1)
    t = t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ---------------------------------------------------------------- SQL (dev only)
def _env(key):
    """Lit une variable du `.env` de la racine. Jamais de valeur en dur : le secret JWT et
    les identifiants postgres diffèrent sur chaque machine de l'équipe."""
    with open(f"{ROOT}/.env") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                if k == key:
                    return v
    raise SystemExit(f"{key} absent de {ROOT}/.env")


def _pg():
    return _env("POSTGRES_USER"), _env("POSTGRES_DB")


def sql(query):
    """Exécute du SQL dans le conteneur postgres. Sert à forcer des états que l'API
    ne permet pas encore d'atteindre (ex. passer un match en `in_progress` avant B5c).

    ⚠️ `-q` est INDISPENSABLE, pas cosmétique : sans lui, psql fait suivre le résultat du
    TAG DE COMMANDE sur les requêtes mutantes (`INSERT ... RETURNING id` rend
    « <uuid>\\nINSERT 0 1 », un `UPDATE` rend « UPDATE 3 »). Les appels qui jettent leur
    retour ne le voyaient pas ; le premier qui a lu la valeur d'un RETURNING s'est pris le
    tag collé derrière. `-t -A` seuls ne suppriment ce tag que pour les SELECT."""
    user, dbname = _pg()
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", user, "-d", dbname, "-tAq", "-c", query],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return out.stdout.strip()


def cleanup():
    """Supprime UNIQUEMENT les users de test (motif TEST_USER_RE) et tout ce qui
    en dépend. Les users du seed-dev et de l'équipe ne sont jamais touchés."""
    user, dbname = _pg()
    script = f"""
BEGIN;
CREATE TEMP TABLE myu AS SELECT id FROM users WHERE pseudo ~ '{TEST_USER_RE}';
CREATE TEMP TABLE mym AS
  SELECT DISTINCT s.match_id FROM match_sides s
  JOIN match_participants p ON p.match_side_id = s.id
  WHERE p.user_id IN (SELECT id FROM myu);
-- B9 : les notifs des users de test tombent par cascade (users), MAIS dispute_needs_admin
-- notifie TOUS les is_admin — y compris de vrais comptes de la base dev. On purge donc
-- par matchId de test (toutes les notifs B9 en portent un dans leur payload jsonb).
DELETE FROM notifications WHERE (data->>'matchId')::uuid IN (SELECT match_id FROM mym);
DELETE FROM match_participants WHERE match_side_id IN
  (SELECT id FROM match_sides WHERE match_id IN (SELECT match_id FROM mym));
-- matches.winner_side_id -> match_sides.id ET match_sides.match_id -> matches.id : référence
-- circulaire. Un match `completed` pointe sur un de ses propres sides -> supprimer match_sides
-- avant de casser ce lien fait échouer TOUTE la transaction (violation FK), qui ROLLBACK EN
-- SILENCE (subprocess.run n'inspecte pas returncode) -> plus RIEN n'était jamais nettoyé.
-- Trouvé le 20/07 : 270 users et 325 matchs de test accumulés depuis le 17/07.
UPDATE matches SET winner_side_id = NULL WHERE id IN (SELECT match_id FROM mym);
DELETE FROM match_sides WHERE match_id IN (SELECT match_id FROM mym);
DELETE FROM matches     WHERE id       IN (SELECT match_id FROM mym);
DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE captain_id IN (SELECT id FROM myu));
DELETE FROM teams        WHERE captain_id IN (SELECT id FROM myu);
DELETE FROM team_members WHERE user_id IN (SELECT id FROM myu);
DELETE FROM user_external_accounts WHERE user_id IN (SELECT id FROM myu);
DELETE FROM users        WHERE id IN (SELECT id FROM myu);
COMMIT;
"""
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", user, "-d", dbname, "-q", "-v", "ON_ERROR_STOP=1"],
        cwd=ROOT,
        input=script,
        capture_output=True,
        text=True,
    )
    # Ne JAMAIS avaler un échec en silence (piège du 20/07) : un ROLLBACK sur violation FK
    # ne lève aucune exception Python -> la suite continue comme si de rien n'était pendant
    # que la base accumule des jours de débris. On préfère planter fort, tout de suite.
    if out.returncode != 0:
        raise RuntimeError(f"cleanup() a échoué (SQL rollback probable) :\n{out.stderr}")


# ---------------------------------------------------------------- assertions
class Suite:
    def __init__(self, title):
        self.title = title
        self.passed = []
        self.failed = []
        print(f"\n{'=' * 66}\n  {title}\n{'=' * 66}")

    def section(self, name):
        print(f"\n── {name} ──")

    def check(self, name, got, want, extra=""):
        ok = got == want
        (self.passed if ok else self.failed).append(name)
        print(f"{'✅' if ok else '❌'} {name}  [attendu {want!r}, reçu {got!r}] {extra}")
        return ok

    def report(self):
        n_ok, n_ko = len(self.passed), len(self.failed)
        print(f"\n{'─' * 66}")
        print(f"  {self.title} : {n_ok} ✅   {n_ko} ❌")
        if self.failed:
            for f in self.failed:
                print(f"    ❌ {f}")
        return n_ok, n_ko
