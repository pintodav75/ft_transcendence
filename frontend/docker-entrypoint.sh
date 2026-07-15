#!/bin/sh
set -eu

LOCK_HASH="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
INSTALLED_HASH="$(cat node_modules/.package-lock.hash 2>/dev/null || true)"

if [ "$LOCK_HASH" != "$INSTALLED_HASH" ]; then
  echo "package-lock.json changed; synchronizing frontend dependencies"
  npm ci
  printf '%s\n' "$LOCK_HASH" > node_modules/.package-lock.hash
fi

exec "$@"
