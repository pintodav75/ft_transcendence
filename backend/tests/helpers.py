"""Outils partagés par les suites de tests end-to-end.

Les tests tapent sur le vrai backend (HTTPS, cert auto-signé) et sur la vraie base
de dev. Ils créent leurs propres utilisateurs (préfixés + suffixe hexa) et les
nettoient à la fin : les données de l'équipe ne sont jamais touchées.
"""

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


def _parse(raw):
    """Toutes les routes ne renvoient pas du JSON (ex. /ping renvoie du texte)."""
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


def register(tag):
    """Crée un user de test. `register` est rate-limité à 3/min → on attend et on
    réessaie sur 429, pour pouvoir enchaîner les suites sans sleep manuel."""
    for attempt in range(6):
        u = uuid.uuid4().hex[:8]
        s, b = req(
            "POST",
            "/auth/register",
            body={"pseudo": f"{tag}{u}", "email": f"{tag}{u}@t.io", "password": "Test1234!"},
        )
        if s == 201:
            return b["accessToken"], b["user"]["id"], f"{tag}{u}"
        if s == 429:
            print(f"   ⏳ rate-limit register — attente 20s ({attempt + 1}/6)")
            time.sleep(20)
            continue
        raise SystemExit(f"register a échoué : {s} {b}")
    raise SystemExit("register : rate-limit jamais levé")


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
def _pg():
    env = {}
    with open(f"{ROOT}/.env") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v
    return env["POSTGRES_USER"], env["POSTGRES_DB"]


def sql(query):
    """Exécute du SQL dans le conteneur postgres. Sert à forcer des états que l'API
    ne permet pas encore d'atteindre (ex. passer un match en `in_progress` avant B5c)."""
    user, dbname = _pg()
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", user, "-d", dbname, "-tA", "-c", query],
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
DELETE FROM match_participants WHERE match_side_id IN
  (SELECT id FROM match_sides WHERE match_id IN (SELECT match_id FROM mym));
DELETE FROM match_sides WHERE match_id IN (SELECT match_id FROM mym);
DELETE FROM matches     WHERE id       IN (SELECT match_id FROM mym);
DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE captain_id IN (SELECT id FROM myu));
DELETE FROM teams        WHERE captain_id IN (SELECT id FROM myu);
DELETE FROM team_members WHERE user_id IN (SELECT id FROM myu);
DELETE FROM user_external_accounts WHERE user_id IN (SELECT id FROM myu);
DELETE FROM users        WHERE id IN (SELECT id FROM myu);
COMMIT;
"""
    subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", user, "-d", dbname, "-q", "-v", "ON_ERROR_STOP=1"],
        cwd=ROOT,
        input=script,
        capture_output=True,
        text=True,
    )


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
