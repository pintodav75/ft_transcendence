"""FT-1C — POST /teams/:id/logo : upload du logo d'équipe (capitaine only).

Le logo d'équipe était jusqu'ici une URL https saisie à la main (`POST /teams`,
`PATCH /teams/:id`) : inutilisable en pratique, il fallait avoir hébergé son image
ailleurs. Cette route fait pour l'équipe ce que `POST /users/me/avatar` fait pour
l'utilisateur — même bucket public `avatars`, même allowlist `IMAGE_MIME`.

Ce que la suite prouve :
  - la garde d'accès est bien celle du capitaine (un membre simple est refusé, pas
    seulement un inconnu) et arrive APRÈS l'authentification (anonyme → 401, jamais 400) ;
  - les 4 refus d'entrée (uuid, non-multipart, aucun fichier, MIME) ;
  - qu'un PDF est refusé : `IMAGE_MIME` ≠ `EVIDENCE_MIME`, un logo est une image ;
  - le cas nominal, y compris la PERSISTANCE (relecture via `GET /teams/:id`) ;
  - le REMPLACEMENT : la nouvelle URL diffère, et l'ancien objet est bien retiré du
    bucket (sinon MinIO accumule un fichier mort à chaque changement de logo) ;
  - le 413 au-dessus de 2 Mo, ET le fait qu'aucun fichier TRONQUÉ n'est stocké ;
  - que les DEUX AUTRES chemins qui déréférencent un logo le suppriment aussi du bucket :
    `PATCH /teams/:id {logoUrl: null}` et `DELETE /teams/:id`. Ils fuyaient (mesuré : objet
    toujours en HTTP 200 après dissolution) — seul le remplacement par un nouvel upload
    nettoyait. Un logo dont l'équipe n'existe plus n'a plus AUCUN porteur : sans ces cas,
    la fuite est invisible côté API et ne se voit qu'en inspectant le bucket.

⚠️ La route est rate-limitée à 20 req/min PAR COMPTE (comme l'avatar) — le `keyGenerator`
global indexe sur le `sub` du JWT dès que la route est authentifiée. Les uploads de cette
suite sont répartis sur alice/bob/carol et passent donc sans attendre. `_post_logo()` garde
son absorption des 429 : c'est un filet si quelqu'un densifie la suite, pas un régime de
croisière.
"""

import base64
import os
import ssl
import time
import urllib.error
import urllib.request
import uuid

from helpers import Suite, ladder_id, register, req, req_multipart

# PNG 1×1 valide (bytes en dur : aucun binaire ajouté au dépôt).
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
# Un « vrai » PDF minimal : accepté comme preuve de dispute, REFUSÉ comme logo.
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
# Juste AU-DESSUS de la limite multipart globale (2 Mo, server.ts) → 413.
# ⚠️ Régression déjà vue : en streamant `file.file` vers MinIO (ce que fait encore
# POST /users/me/avatar), busboy TRONQUE le fichier sans bruit et la route répond 200 avec une
# image amputée à exactement 2 097 152 octets. D'où ce cas, qui garde le 413 honnête.
# ⚠️ « +100 octets » et pas « 3 Mo » (même ruse que BIG dans test_disputes) : urllib écrit TOUT
# le corps avant de lire la réponse. Si le serveur répond 413 alors qu'il reste des méga-octets
# à envoyer, le client se prend un ECONNRESET (-1) au lieu de lire le 413 — le back, lui, répond
# bien 413 (vérifié au curl, qui négocie un `Expect: 100-continue`). En dépassant la limite de
# 100 octets, l'écriture est terminée quand le refus tombe : le 413 est lu de façon déterministe.
TOO_BIG = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024 + 100)

# Le bucket `avatars` est public en lecture : on peut vérifier en direct qu'un objet
# existe (200) ou a bien été supprimé (404). Surchargeable si MinIO n'est pas exposé ici.
MINIO_BASE = os.environ.get("MINIO_BASE_URL", "http://localhost:9000")

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def _post_logo(team_id, token, files=(), json_body=None):
    """POST /teams/:id/logo en absorbant le rate-limit de la route (20/min, PAR COMPTE).

    Cette boucle ne devrait JAMAIS se déclencher. Si tu la vois s'afficher, un même compte
    dépasse 20 uploads/min — répartis-les sur alice/bob/carol, ne rallonge pas l'attente.

    `json_body` force un corps JSON (pour tester le refus du non-multipart)."""
    for attempt in range(10):
        if json_body is not None:
            st, b = req("POST", f"/teams/{team_id}/logo", token, json_body)
        else:
            st, b = req_multipart("POST", f"/teams/{team_id}/logo", token, files=files)
        if st != 429:
            return st, b
        print(f"   ⏳ rate-limit logo (20/min) — attente 21s ({attempt + 1}/10)")
        time.sleep(21)
    raise SystemExit("rate-limit logo : jamais levé")


def _object_status(logo_url):
    """Statut HTTP de l'objet MinIO derrière un `logoUrl` (/media/avatars/<clé>).
    Renvoie -1 si MinIO n'est pas joignable depuis cette machine."""
    key = logo_url.rsplit("/", 1)[-1]
    try:
        with urllib.request.urlopen(f"{MINIO_BASE}/avatars/{key}", context=_CTX) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return -1


def run():
    s = Suite("FT-1C — POST /teams/:id/logo (upload du logo d'équipe)")

    tokA, _idA, _pA = register("alice")  # capitaine
    tokB, idB, _pB = register("bob")  # membre simple
    tokC, _idC, _pC = register("carol")  # étranger à l'équipe

    VAL2 = ladder_id(tokA, "val", "2v2")
    _, b = req("POST", "/teams", tokA, {"ladderId": VAL2, "name": "Logo" + uuid.uuid4().hex[:5]})
    TEAM = b["team"]["id"]
    st, _ = req("POST", f"/teams/{TEAM}/members", tokA, {"userId": idB})
    s.check("bob rejoint l'équipe (préparation)", st, 201)

    png = [("logo", "logo.png", PNG, "image/png")]

    s.section("Authentification et forme du :id")
    st, _ = _post_logo(TEAM, None, files=png)
    s.check("sans token → 401 (jamais 400 : Zod passe APRÈS authenticate)", st, 401)
    st, _ = _post_logo("pas-un-uuid", tokA, files=png)
    s.check("uuid malformé → 400", st, 400)
    st, _ = _post_logo("00000000-0000-4000-8000-000000000000", tokA, files=png)
    s.check("uuid valide mais équipe inexistante → 404", st, 404)

    s.section("Garde d'accès : capitaine only")
    st, _ = _post_logo(TEAM, tokB, files=png)
    s.check("membre NON capitaine → 403", st, 403)
    st, _ = _post_logo(TEAM, tokC, files=png)
    s.check("non-membre → 403", st, 403)

    s.section("Forme du corps")
    st, _ = _post_logo(TEAM, tokA, json_body={"logoUrl": "https://example.com/x.png"})
    s.check("corps JSON (non multipart) → 400", st, 400)
    st, _ = _post_logo(TEAM, tokA, files=())
    s.check("multipart sans fichier → 400", st, 400)
    st, _ = _post_logo(TEAM, tokA, files=[("logo", "e.pdf", PDF, "application/pdf")])
    s.check("application/pdf → 400 (IMAGE_MIME, pas EVIDENCE_MIME)", st, 400)

    s.section("Cas nominal")
    st, b = _post_logo(TEAM, tokA, files=png)
    s.check("png valide → 200", st, 200, b.get("error", ""))
    first = (b.get("team") or {}).get("logoUrl")
    s.check("logoUrl non nul", first is not None, True, str(first))
    s.check(
        "logoUrl est un chemin /media/ servi par nous",
        bool(first and first.startswith("/media/")),
        True,
        str(first),
    )
    st, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check("valeur PERSISTÉE (relecture GET /teams/:id)", b["team"]["logoUrl"], first)

    s.section("Remplacement d'un logo existant")
    before = _object_status(first)
    st, b = _post_logo(TEAM, tokA, files=[("logo", "logo2.png", PNG, "image/png")])
    s.check("2e upload → 200", st, 200, b.get("error", ""))
    second = (b.get("team") or {}).get("logoUrl")
    s.check("l'URL a changé", second != first and bool(second), True, f"{first} → {second}")
    st, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check("la nouvelle URL est persistée", b["team"]["logoUrl"], second)
    # L'ancien objet ne doit plus exister : sans ça le bucket accumule un fichier mort à
    # chaque changement de logo. On ne teste que si MinIO est joignable d'ici (200 avant).
    if before == 200:
        s.check("l'ANCIEN objet a été supprimé de MinIO", _object_status(first), 404)
        s.check("le NOUVEL objet est bien dans le bucket", _object_status(second), 200)
    else:
        print(f"   ⏭️  MinIO non joignable sur {MINIO_BASE} — vérif du bucket sautée")

    s.section("Fichier trop gros")
    st, _ = _post_logo(TEAM, tokA, files=[("logo", "big.png", TOO_BIG, "image/png")])
    # ⚠️ 413 OU -1 : le back répond bien 413 (`{"error":"File too large"}`, vérifié au curl),
    # mais urllib écrit TOUT le corps avant de lire la réponse — quand le serveur refuse et
    # ferme pendant que le client écrit encore, urllib voit un ECONNRESET (-1) au lieu du 413.
    # C'est un artefact du CLIENT, pas du serveur : accepter les deux évite un test qui vire
    # au rouge une fois sur deux. L'assertion qui suit est celle qui compte vraiment.
    s.check("fichier > 2 Mo (limite globale) → refusé (413 ou coupure client)", st in (413, -1), True, f"reçu {st}")
    st, b = req("GET", f"/teams/{TEAM}", tokA)
    s.check(
        "le logo précédent n'a PAS été écrasé par un fichier tronqué",
        b["team"]["logoUrl"],
        second,
    )

    # Le remplacement par un nouvel upload était le SEUL chemin qui nettoyait le bucket. Les
    # deux autres façons de déréférencer un logo laissaient l'objet derrière elles.
    s.section("Nettoyage du bucket sur les autres chemins de déréférencement")
    minio_reachable = _object_status(second) == 200

    st, b = req("PATCH", f"/teams/{TEAM}", tokA, {"logoUrl": None})
    s.check("PATCH logoUrl:null → 200", st, 200, b.get("error", ""))
    s.check("… et le logo est bien retiré", (b.get("team") or {}).get("logoUrl"), None)
    if minio_reachable:
        s.check("l'objet déréférencé par le PATCH est supprimé du bucket", _object_status(second), 404)

    st, b = _post_logo(TEAM, tokA, files=png)
    s.check("nouvel upload après retrait → 200", st, 200, b.get("error", ""))
    third = (b.get("team") or {}).get("logoUrl")

    st, _ = req("DELETE", f"/teams/{TEAM}", tokA)
    s.check("dissolution de l'équipe → 200", st, 200)
    if minio_reachable:
        # Le cas qui compte : l'équipe n'existe plus, personne ne pointe plus sur cet objet.
        s.check("l'objet de l'équipe DISSOUTE est supprimé du bucket", _object_status(third), 404)
    else:
        print(f"   ⏭️  MinIO non joignable sur {MINIO_BASE} — vérifs du bucket sautées")

    return s.report()


if __name__ == "__main__":
    from helpers import cleanup

    try:
        run()
    finally:
        cleanup()
