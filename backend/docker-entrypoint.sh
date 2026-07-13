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

if [ ! -s "$CERT_FILE" ] || [ ! -s "$KEY_FILE" ]; then
  echo "Generating the backend development TLS certificate"
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
