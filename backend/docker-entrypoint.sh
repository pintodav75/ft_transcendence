#!/bin/sh
set -eu

LOCK_HASH="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
INSTALLED_HASH="$(cat node_modules/.package-lock.hash 2>/dev/null || true)"

if [ "$LOCK_HASH" != "$INSTALLED_HASH" ]; then
  echo "package-lock.json changed; synchronizing backend dependencies"
  npm ci
  printf '%s\n' "$LOCK_HASH" > node_modules/.package-lock.hash
fi

CERT_DIR=/app/certs
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"
# Marge de renouvellement : on régénère si le cert expire dans moins de 7 jours (604800 s),
# pour ne jamais servir avec un cert périmé du jour au lendemain.
CERT_RENEW_SECONDS=604800

cert_needs_regen() {
  # Manquant ou vide.
  [ ! -s "$CERT_FILE" ] && return 0
  [ ! -s "$KEY_FILE" ] && return 0
  # Cert illisible / invalide (openssl ne parvient pas à le parser).
  openssl x509 -in "$CERT_FILE" -noout >/dev/null 2>&1 || return 0
  # Clé illisible / invalide : -check valide la cohérence interne de la clé privée. Sans ça,
  # un `key.pem` corrompu passait (on ne testait que « non vide ») → Fastify crash → restart-loop.
  openssl pkey -in "$KEY_FILE" -check -noout >/dev/null 2>&1 || return 0
  # Cert et clé APPARIÉS : on compare les clés publiques dérivées de l'un et de l'autre. Un cert
  # valide + une clé valide mais d'une AUTRE paire feraient aussi crasher Fastify (mismatch TLS).
  cert_pub="$(openssl x509 -in "$CERT_FILE" -pubkey -noout 2>/dev/null)"
  key_pub="$(openssl pkey -in "$KEY_FILE" -pubout 2>/dev/null)"
  [ -z "$cert_pub" ] && return 0
  [ -z "$key_pub" ] && return 0
  [ "$cert_pub" != "$key_pub" ] && return 0
  # Expire bientôt (ou déjà expiré) : -checkend renvoie non-zéro si le cert expire dans la fenêtre.
  openssl x509 -in "$CERT_FILE" -noout -checkend "$CERT_RENEW_SECONDS" >/dev/null 2>&1 || return 0
  return 1
}

if cert_needs_regen; then
  echo "Generating the backend development TLS certificate (missing, invalid or expiring soon)"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -nodes \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1
  chmod 600 "$KEY_FILE"
fi

echo "Applying database migrations"
./node_modules/.bin/drizzle-kit migrate

exec "$@"
