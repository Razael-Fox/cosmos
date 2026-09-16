#!/bin/sh
set -eu

STORAGE_DIR="${STORAGE_DIR:-/app/storage}"
DB_FILE="${DATABASE_URL:-file:/app/storage/database.sqlite}"
DB_PATH=$(printf '%s' "$DB_FILE" | sed 's|^file:||')

mkdir -p "$STORAGE_DIR/logs" "$STORAGE_DIR/auth_info_baileys"
chmod 700 "$STORAGE_DIR" || true
chmod 600 "$DB_PATH" 2>/dev/null || true

if [ ! -f "$DB_PATH" ]; then
  echo "[Entrypoint] Primary database not found at $DB_PATH; it will be bootstrapped on first boot."
fi

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "[Entrypoint] Cloudflare Tunnel token detected; tunnel supervision enabled."
else
  echo "[Entrypoint] CLOUDFLARE_TUNNEL_TOKEN is empty; running without tunnel (direct ingress)."
fi

exec "$@"
