"""B7 — disputes : dépôt de preuve, lecture du fil, file admin, arbitrage, job 24 h.

Une dispute naît d'un désaccord de score (B6 met le match en `disputed`). B7 en est la
SEULE sortie. Ce qui doit rester vrai :
  - dépôt de preuve = capitaine (2v2+) / joueur (1v1) d'un des deux camps, image + message ;
    validé EN MÉMOIRE avant tout upload (pas d'orphelin), bucket PRIVÉ, insert sous verrou
  - lecture du fil = participant (banc compris, même garde que GET /matches/:id) OU admin ;
    expose ce que CHAQUE camp a déclaré (sides + submittedWinnerSideId) ; AUCUN champ privé
  - file d'arbitrage = GET /disputes admin-only, triée de la plus ancienne à la plus récente
  - arbitrage = admin only ; side_0/1_wins -> completed + ELO ; cancelled -> annulé, ELO figé
  - le match sort de `disputed` -> les camps sont libérés (§5.2) et peuvent rejouer
  - job 24 h : une dispute `open` depuis +24 h est auto-annulée (issue NEUTRE, sans admin) —
    même avec une preuve d'un seul camp (décision actée : le robot ne juge jamais une preuve)

Job 24 h en opt-in (B7_JOBS=1, +65 s) comme B6_JOBS.
"""

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid

from helpers import BASE, CTX, Suite, future, ladder_id, link, register, req, sql

PRIVATE_FIELDS = ("email", "passwordHash", "password_hash", "totpSecret", "totp_secret")

# PNG 1×1 valide, pour les uploads de preuve.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
# ~3 Mo : au-dessus de la limite globale multipart (2 Mo), en-dessous de la limite par-route (5 Mo).
MID = b"\x89PNG\r\n\x1a\n" + b"\x00" * (3 * 1024 * 1024)
# > 5 Mo : doit être refusé.
BIG = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 100)


def post_evidence(token, disp_id, message, img=PNG, mime="image/png", n_files=1):
    """POST multipart /disputes/:id/evidence (req() ne fait que du JSON). Renvoie (status, json).

    `n_files` > 1 empile plusieurs parties fichier `evidence` (pour tester les bornes multipart).
    Résilient : si le serveur coupe la connexion en cours d'upload (cas d'un fichier trop gros
    rejeté avant la fin du corps), on renvoie (-1, ...) plutôt que de crasher."""
    boundary = "----b" + uuid.uuid4().hex
    body = b""
    if img is not None:
        for _ in range(n_files):
            body += (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="evidence"; filename="e.png"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode() + img + b"\r\n"
    if message is not None:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="message"\r\n\r\n{message}\r\n'
        ).encode()
    body += f"--{boundary}--\r\n".encode()

    r = urllib.request.Request(BASE + f"/disputes/{disp_id}/evidence", data=body, method="POST")
    r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}
    except (urllib.error.URLError, OSError):
        return -1, {"raw": "connection aborted"}


# Depuis I4 l'URL présignée renvoyée par l'API est RELATIVE (/media/evidence/<clé>?X-Amz-...) :
# elle n'est résoluble qu'à travers le proxy same-origin. On la résout donc contre l'origine
# applicative (5173 par défaut ; PROXY_BASE_URL surchargeable).
PROXY_BASE = os.environ.get("PROXY_BASE_URL", "https://localhost:5173")


def _absolutize(url):
    return f"{PROXY_BASE}{url}" if url.startswith("/") else url


def raw_get_signed(url):
    """GET l'URL présignée COMPLÈTE (avec signature) via le proxy /media → doit être 200.
    Prouve que la signature reste valide à travers le proxy (Host interne rétabli)."""
    try:
        with urllib.request.urlopen(_absolutize(url), context=CTX) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return -1


def raw_get_no_sig(url):
    """GET une URL présignée en RETIRANT sa query (donc sans signature) → doit être refusé par
    MinIO (bucket privé). Renvoie le status HTTP (-1 si erreur transport)."""
    base = _absolutize(url).split("?", 1)[0]
    try:
        with urllib.request.urlopen(base, context=CTX) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return -1


def status_of(m):
    return sql(f"select status from matches where id='{m}';")


def disputed_1v1(tok_creator, tok_acceptor, ladder):
    """Crée un 1v1, l'accepte, backdate, désaccord -> disputed. Renvoie (M, DISP, s0, s1)."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": future()})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{m}';")
    s0 = sql(f"select id from match_sides where match_id='{m}' and side_index=0;")
    s1 = sql(f"select id from match_sides where match_id='{m}' and side_index=1;")
    # Chacun se déclare vainqueur de SON propre côté, 2-0 — vainqueurs différents -> disputed.
    req("POST", f"/matches/{m}/result", tok_creator, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{m}/result", tok_acceptor, {"winnerSideId": s1, "scoreSelf": 2, "scoreOpponent": 0})
    disp = sql(f"select id from disputes where match_id='{m}';")
    return m, disp, s0, s1


def disputed_future(tok_creator, tok_acceptor, ladder, at):
    """1v1 accepté à l'heure `at` (fenêtre FUTURE) puis forcé `disputed` par SQL. Renvoie (M, DISP).

    On ne passe PAS par /result : ça exigerait de backdater scheduled_at, ce qui mettrait la
    fenêtre dans le passé et masquerait le lockout qu'on veut justement tester."""
    _, b = req("POST", "/matches", tok_creator, {"ladderId": ladder, "scheduledAt": at})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_acceptor)
    sql(f"update matches set status='disputed' where id='{m}';")
    # NB : `insert ... returning id` via psql renvoie AUSSI le tag « INSERT 0 1 » sur stdout →
    # on insère puis on relit proprement l'id.
    sql(f"insert into disputes (match_id) values ('{m}');")
    disp = sql(f"select id from disputes where match_id='{m}';")
    return m, disp


def disputed_2v2(tok_cap_a, id_cap_a, id_mem_a, tok_cap_b, id_cap_b, id_mem_b, ladder):
    """2v2 team A vs team B, backdate, désaccord des 2 CAPITAINES -> disputed.
    Renvoie (M, DISP, s0, s1, team_A_id). (Lineup A = [cap_a, mem_a], B = [cap_b, mem_b].)"""
    ta = (req("POST", "/teams", tok_cap_a, {"ladderId": ladder, "name": "A" + uuid.uuid4().hex[:6]})[1].get("team") or {}).get("id")
    req("POST", f"/teams/{ta}/members", tok_cap_a, {"userId": id_mem_a})
    tb = (req("POST", "/teams", tok_cap_b, {"ladderId": ladder, "name": "B" + uuid.uuid4().hex[:6]})[1].get("team") or {}).get("id")
    req("POST", f"/teams/{tb}/members", tok_cap_b, {"userId": id_mem_b})
    _, b = req("POST", "/matches", tok_cap_a, {"ladderId": ladder, "scheduledAt": future(), "lineup": [id_cap_a, id_mem_a]})
    m = b["match"]["id"]
    req("POST", f"/matches/{m}/accept", tok_cap_b, {"lineup": [id_cap_b, id_mem_b]})
    sql(f"update matches set scheduled_at = now() - interval '1 hour' where id='{m}';")
    s0 = sql(f"select id from match_sides where match_id='{m}' and side_index=0;")
    s1 = sql(f"select id from match_sides where match_id='{m}' and side_index=1;")
    req("POST", f"/matches/{m}/result", tok_cap_a, {"winnerSideId": s0, "scoreSelf": 2, "scoreOpponent": 0})
    req("POST", f"/matches/{m}/result", tok_cap_b, {"winnerSideId": s1, "scoreSelf": 2, "scoreOpponent": 0})
    disp = sql(f"select id from disputes where match_id='{m}';")
    return m, disp, s0, s1, ta


def _thread(res, tag, fn, gate):
    # ⚠️ BARRIÈRE : sans elle les threads partent en décalé et ne se croisent jamais → faux
    # négatif. On synchronise le départ pour forcer la course.
    gate.wait()
    res[tag] = fn()


def run():
    s = Suite("B7 — disputes (preuve, lecture, file admin, arbitrage, job)")

    tokA, idA, _ = register("alice")  # joueur side 0
    tokB, idB, _ = register("bob")  # joueur side 1
    tokC, idC, _ = register("carol")  # non-participant
    tokADM, idADM, _ = register("erin")  # admin
    # Deux users de plus pour le scénario 2v2 (tag `dave` pour matcher le regex de cleanup).
    tokBench, idBench, _ = register("dave")  # membre du BANC de team A (pas dans la lineup)
    tokMemB, idMemB, _ = register("dave")  # 2e joueur de team B
    CHESS = ladder_id(tokA, "chess", "1v1")
    VAL2 = ladder_id(tokA, "val", "2v2")
    for t in (tokA, tokB, tokC):  # carol liée aussi (sert au job) ; reste non-participant de D1
        link(t, "chess_com")
    for t in (tokA, tokB, tokC, tokMemB):  # §5.1 val 2v2 : la lineup doit avoir un compte lié
        link(t, "riot")
    sql(f"update users set is_admin=true where id='{idADM}';")

    M1, D1, s0, s1 = disputed_1v1(tokA, tokB, CHESS)

    # ── Route A : dépôt de preuve ──────────────────────────────────────────
    s.section("POST /disputes/:id/evidence")
    st, _ = post_evidence(tokA, D1, "team A a gagne 13-7")
    s.check("alice (participant s0) -> 201", st, 201)
    st, _ = post_evidence(tokC, D1, "je passais par la")
    s.check("carol (non-participant) -> 403", st, 403)
    st, _ = post_evidence(tokA, D1, None)
    s.check("sans message -> 400", st, 400)
    st, _ = post_evidence(tokA, D1, "x", mime="text/plain")
    s.check("mauvais type MIME -> 400", st, 400)
    st, _ = post_evidence(tokA, D1, None, img=None)  # ni image ni message
    s.check("sans image -> 400", st, 400)
    st, _ = post_evidence(tokA, str(uuid.uuid4()), "x")
    s.check("dispute inexistante -> 404", st, 404)
    st, _ = post_evidence(None, D1, "x")
    s.check("sans auth -> 401", st, 401)
    st, _ = req("POST", f"/disputes/{D1}/evidence", tokA, {})
    s.check("non-multipart (JSON) -> 400", st, 400)
    st, _ = post_evidence(tokA, "pas-un-uuid", "x")
    s.check("id malforme -> 400", st, 400)
    # taille : la limite PAR-ROUTE (5 Mo) doit l'emporter sur la limite globale (2 Mo).
    st, _ = post_evidence(tokA, D1, "3 Mo, sous la limite route", img=MID)
    s.check("fichier 3 Mo (>2 Mo global, <5 Mo route) -> 201", st, 201)
    st, _ = post_evidence(tokA, D1, "trop gros", img=BIG)
    s.check("fichier > 5 Mo -> 413", st, 413)
    st, _ = post_evidence(tokA, D1, "deux fichiers", n_files=2)
    s.check("2 fichiers dans une requete -> 400 (borne multipart)", st, 400)

    # ── Route B : lecture du fil + déclarations des camps ──────────────────
    s.section("GET /disputes/:id")
    st, body = req("GET", f"/disputes/{D1}", tokA)
    s.check("alice (participant) -> 200", st, 200)
    ev = body.get("evidence", []) if isinstance(body, dict) else []
    s.check("le fil contient les preuves postees", len(ev) >= 1, True)
    if ev:
        s.check("preuve rattachee au side 0", ev[0].get("matchSideId"), s0)
        s.check("preuve a un auteur (pseudo)", "pseudo" in (ev[0].get("author") or {}), True)
        s.check("evidenceUrl presignee (query X-Amz)", "X-Amz-" in (ev[0].get("evidenceUrl") or ""), True)
        s.check("evidenceUrl relative sous /media (I4)", (ev[0].get("evidenceUrl") or "").startswith("/media/evidence/"), True)
        s.check("preuve LISIBLE avec signature via /media -> 200", raw_get_signed(ev[0].get("evidenceUrl") or ""), 200)
        s.check("preuve INACCESSIBLE sans signature -> 403", raw_get_no_sig(ev[0].get("evidenceUrl") or ""), 403)
    # les DÉCLARATIONS des deux camps : c'est ce qui rend l'arbitrage possible.
    sides = body.get("sides", []) if isinstance(body, dict) else []
    s.check("2 sides exposes", len(sides), 2)
    if len(sides) == 2:
        s.check("sides tries par index", [x.get("sideIndex") for x in sides], [0, 1])
        s.check("side 0 a declare s0 vainqueur", sides[0].get("submittedWinnerSideId"), s0)
        s.check("side 1 a declare s1 vainqueur", sides[1].get("submittedWinnerSideId"), s1)
        s.check("side 0 team null (1v1)", sides[0].get("team"), None)
        s.check("side 0 expose son joueur (pseudo)", any("pseudo" in p for p in sides[0].get("players", [])), True)
    raw = json.dumps(body)
    for f in PRIVATE_FIELDS:
        s.check(f"pas de fuite '{f}'", f in raw, False)
    st, _ = req("GET", f"/disputes/{D1}", tokC)
    s.check("carol (etranger) -> 403", st, 403)
    st, _ = req("GET", f"/disputes/{D1}", tokADM)
    s.check("admin -> 200", st, 200)
    st, _ = req("GET", f"/disputes/{uuid.uuid4()}", tokA)
    s.check("dispute inexistante -> 404", st, 404)
    st, _ = req("GET", f"/disputes/{D1}", None)
    s.check("sans auth -> 401", st, 401)

    # ── Route C : disputeId dans le match ──────────────────────────────────
    s.section("GET /matches/:id expose disputeId")
    _, m = req("GET", f"/matches/{M1}", tokA)
    s.check("match disputed -> disputeId present", m["match"].get("disputeId"), D1)

    # ── File d'arbitrage admin ─────────────────────────────────────────────
    s.section("GET /disputes — file d'arbitrage (admin)")
    st, _ = req("GET", "/disputes", None)
    s.check("sans auth -> 401", st, 401)
    st, _ = req("GET", "/disputes", tokA)
    s.check("non-admin -> 403", st, 403)
    # une dispute fraiche avec une preuve : doit apparaitre, avec son evidenceCount.
    Mq, Dq, _, _ = disputed_1v1(tokA, tokB, CHESS)
    stp, _ = post_evidence(tokA, Dq, "preuve pour la file")
    s.check("preuve postee sur Dq -> 201", stp, 201)
    st, body = req("GET", "/disputes", tokADM)
    s.check("admin -> 200", st, 200)
    ds = body.get("disputes", []) if isinstance(body, dict) else []
    mine = [d for d in ds if d.get("id") == Dq]
    s.check("dispute ouverte presente dans la file", len(mine), 1)
    if mine:
        s.check("evidenceCount reflete les preuves", mine[0].get("evidenceCount"), 1)
        s.check("la file expose ladderId", mine[0].get("ladderId"), CHESS)
    # tri : la plus ancienne d'abord (on backdate Dq, on cree Dq2 apres).
    sql(f"update disputes set created_at = now() - interval '2 hours' where id='{Dq}';")
    Mq2, Dq2, _, _ = disputed_1v1(tokA, tokB, CHESS)
    _, body = req("GET", "/disputes", tokADM)
    order = [d.get("id") for d in body.get("disputes", [])]
    if Dq in order and Dq2 in order:
        s.check("tri: la plus ancienne (Dq) avant la plus recente (Dq2)", order.index(Dq) < order.index(Dq2), True)

    # ── Résolution admin ───────────────────────────────────────────────────
    s.section("POST /disputes/:id/resolve")
    st, _ = req("POST", f"/disputes/{D1}/resolve", tokC, {"resolution": "side_0_wins"})
    s.check("non-admin -> 403", st, 403)
    st, _ = req("POST", f"/disputes/{D1}/resolve", None, {"resolution": "side_0_wins"})
    s.check("sans auth -> 401", st, 401)
    st, _ = req("POST", f"/disputes/{D1}/resolve", tokADM, {"resolution": "banana"})
    s.check("resolution invalide -> 400", st, 400)
    st, _ = req("POST", f"/disputes/{uuid.uuid4()}/resolve", tokADM, {"resolution": "cancelled"})
    s.check("dispute inexistante -> 404", st, 404)
    st, _ = req(
        "POST", f"/disputes/{D1}/resolve", tokADM, {"resolution": "side_0_wins", "notes": "preuve A ok"}
    )
    s.check("admin side_0_wins -> 200", st, 200)
    s.check("match -> completed", status_of(M1), "completed")
    s.check("winner_side_id = side 0", sql(f"select winner_side_id from matches where id='{M1}';"), s0)
    s.check("ELO gagnant alice = 1016", sql(f"select elo from rankings where user_id='{idA}' and ladder_id='{CHESS}';"), "1016")
    s.check("ELO perdant bob = 984", sql(f"select elo from rankings where user_id='{idB}' and ladder_id='{CHESS}';"), "984")
    # B14 — arbitrage admin : l'admin tranche un VAINQUEUR, pas un score -> `score` reste
    # NULL sur les deux sides, mais l'ELO (delta + après-match) est bien écrit, comme pour
    # un accord classique.
    s.check("B14 — score reste NULL côté vainqueur (arbitrage, pas de score soumis)", sql(f"select coalesce(score::text,'NULL') from match_sides where id='{s0}';"), "NULL")
    s.check("B14 — score reste NULL côté perdant", sql(f"select coalesce(score::text,'NULL') from match_sides where id='{s1}';"), "NULL")
    s.check("B14 — eloDelta gagnant = +16", sql(f"select elo_delta from match_sides where id='{s0}';"), "16")
    s.check("B14 — eloAfter gagnant = 1016", sql(f"select elo_after from match_sides where id='{s0}';"), "1016")
    s.check("B14 — eloDelta perdant = -16", sql(f"select elo_delta from match_sides where id='{s1}';"), "-16")
    s.check("B14 — eloAfter perdant = 984", sql(f"select elo_after from match_sides where id='{s1}';"), "984")
    s.check(
        "dispute resolved + resolution",
        sql(f"select status||'/'||resolution from disputes where id='{D1}';"),
        "resolved/side_0_wins",
    )
    s.check("resolved_by = admin", sql(f"select resolved_by_user_id from disputes where id='{D1}';"), idADM)
    st, _ = req("POST", f"/disputes/{D1}/resolve", tokADM, {"resolution": "cancelled"})
    s.check("re-resolution d'une dispute close -> 409", st, 409)

    # ── Résolution 'cancelled' : le match est annulé, l'ELO ne bouge PAS ────
    s.section("Résolution 'cancelled' -> ELO figé")
    M2, D2, _, _ = disputed_1v1(tokA, tokB, CHESS)  # alice/bob sont 1016/984 depuis D1
    st, _ = req("POST", f"/disputes/{D2}/resolve", tokADM, {"resolution": "cancelled"})
    s.check("admin cancelled -> 200", st, 200)
    s.check("match -> cancelled", status_of(M2), "cancelled")
    s.check("ELO alice inchange (1016)", sql(f"select elo from rankings where user_id='{idA}' and ladder_id='{CHESS}';"), "1016")
    s.check("ELO bob inchange (984)", sql(f"select elo from rankings where user_id='{idB}' and ladder_id='{CHESS}';"), "984")

    # ── La résolution LIBÈRE la fenêtre (les deux camps peuvent rejouer) ────
    s.section("Résolution -> fenêtre libérée -> rejouable")
    T3 = future(3)  # fenêtre FUTURE, pour que le lockout §5.2 s'applique vraiment
    Mx, Dx = disputed_future(tokA, tokB, CHESS, T3)
    st, _ = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T3})
    s.check("disputé -> fenêtre occupée -> alice rouvre a T3 refusee (409)", st, 409)
    st, _ = req("POST", f"/disputes/{Dx}/resolve", tokADM, {"resolution": "cancelled"})
    s.check("admin résout -> 200", st, 200)
    st, b = req("POST", "/matches", tokA, {"ladderId": CHESS, "scheduledAt": T3})
    s.check("après résolution -> alice rejoue a T3 -> 201", st, 201)
    if isinstance(b, dict) and b.get("match"):
        st, _ = req("POST", f"/matches/{b['match']['id']}/accept", tokB)
        s.check("bob s'engage a nouveau a T3 -> 200/201", st in (200, 201), True)

    # ── Course : dépôt de preuve ↔ résolution (barrière) ───────────────────
    s.section("Course — dépôt ↔ résolution (barrière, x3)")
    for _ in range(3):
        Mr, Dr, _, _ = disputed_1v1(tokA, tokB, CHESS)
        res = {}
        gate = threading.Barrier(2)
        threads = [
            threading.Thread(target=_thread, args=(res, "post", lambda: post_evidence(tokA, Dr, "course"), gate)),
            threading.Thread(target=_thread, args=(res, "resolve", lambda: req("POST", f"/disputes/{Dr}/resolve", tokADM, {"resolution": "cancelled"}), gate)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        post_st, resolve_st = res["post"][0], res["resolve"][0]
        s.check("resolve -> 200", resolve_st, 200)
        s.check("post -> 201 (avant) ou 409 (après)", post_st in (201, 409), True)
        s.check("aucun 500", 500 not in (post_st, resolve_st), True)
        s.check("dispute close proprement", status_of(Mr), "cancelled")

    # ── Chemin ÉQUIPE (2v2) : dépôt = capitaine seul, lecture banc comprise ─
    s.section("2v2 — dépôt capitaine-seul, joueur aligné refusé, banc en lecture")
    M2, D2v2, s0t, s1t, TA = disputed_2v2(tokA, idA, idB, tokC, idC, idMemB, VAL2)
    req("POST", f"/teams/{TA}/members", tokA, {"userId": idBench})  # banc de team A
    st, _ = post_evidence(tokA, D2v2, "capitaine A depose")
    s.check("capitaine A depose -> 201", st, 201)
    st, _ = post_evidence(tokB, D2v2, "joueur aligne non-capitaine")
    s.check("joueur aligne NON-capitaine (bob) -> 403", st, 403)
    _, body = req("GET", f"/disputes/{D2v2}", tokA)
    evs = body.get("evidence", []) if isinstance(body, dict) else []
    s.check("preuve du capitaine A rattachee au side team A (0)", evs[0].get("matchSideId") if evs else None, s0t)
    st, _ = req("GET", f"/disputes/{D2v2}", tokBench)
    s.check("membre du BANC de team A lit -> 200", st, 200)
    st, _ = req("GET", f"/disputes/{D2v2}", tokB)
    s.check("joueur aligne lit -> 200", st, 200)
    st, _ = req("GET", f"/disputes/{D2v2}", tokMemB)
    s.check("joueur de la team ADVERSE lit aussi (participant) -> 200", st, 200)

    # ── Job 24 h (opt-in) ──────────────────────────────────────────────────
    if os.environ.get("B7_JOBS"):
        s.section("Job 24h — auto-cancel (⏳ attend un tick ~65s)")
        M3, D3, _, _ = disputed_1v1(tokA, tokB, CHESS)
        # Une preuve d'UN camp : le job doit QUAND MÊME annuler (issue neutre — décision actée,
        # le robot ne juge jamais une preuve, contrairement aux 3 branches de la carte d'origine).
        post_evidence(tokA, D3, "j'ai gagne, preuve jointe")
        sql(f"update disputes set created_at = now() - interval '25 hours' where id='{D3}';")
        M4, D4, _, _ = disputed_1v1(tokC, tokB, CHESS)  # dispute récente -> doit rester
        print("   ⏳ attente d'un tick du planificateur (65s)...")
        time.sleep(65)
        s.check("dispute +24h (avec preuve) -> match cancelled", status_of(M3), "cancelled")
        s.check(
            "dispute +24h -> resolved/cancelled",
            sql(f"select status||'/'||resolution from disputes where id='{D3}';"),
            "resolved/cancelled",
        )
        s.check("dispute +24h -> pas d'admin (resolved_by NULL)", sql(f"select coalesce(resolved_by_user_id::text,'NULL') from disputes where id='{D3}';"), "NULL")
        s.check("dispute recente -> reste open", sql(f"select status from disputes where id='{D4}';"), "open")
    else:
        s.section("Job 24h — SKIP (B7_JOBS=1 pour tester, +65s)")

    return s.report()
