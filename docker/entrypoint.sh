#!/bin/sh
set -eu

STORAGE_DIR="${STORAGE_DIR:-/app/storage}"
DB_FILE="${DATABASE_URL:-file:/app/storage/database.sqlite}"
DB_PATH=$(printf '%s' "$DB_FILE" | sed 's|^file:||')
IPC_SOCK="${BOT_IPC_SOCKET:-/app/storage/ipc.sock}"

mkdir -p "$STORAGE_DIR/logs" "$STORAGE_DIR/auth_info_baileys" "$STORAGE_DIR/sub-bot" 2>/dev/null || true
chmod 700 "$STORAGE_DIR" 2>/dev/null || true
chmod 600 "$DB_PATH" 2>/dev/null || true

# Clean up stale IPC socket and pid files from previous abnormal shutdowns
if [ -S "$IPC_SOCK" ] || [ -f "$IPC_SOCK" ]; then
  echo "[Entrypoint] Removing stale IPC socket at $IPC_SOCK..."
  rm -f "$IPC_SOCK" 2>/dev/null || true
fi
rm -f /tmp/nginx.pid 2>/dev/null || true

# Validate storage directory write permissions
if [ ! -w "$STORAGE_DIR" ]; then
  echo "[Entrypoint] WARNING: Storage directory ($STORAGE_DIR) is not writable by UID $(id -u)! Database and session storage may fail."
fi

if [ ! -f "$DB_PATH" ]; then
  echo "[Entrypoint] Primary database not found at $DB_PATH; it will be bootstrapped on first boot."
fi

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "[Entrypoint] Cloudflare Tunnel token detected; tunnel supervision enabled."
else
  echo "[Entrypoint] CLOUDFLARE_TUNNEL_TOKEN is empty; running without tunnel (direct ingress)."
fi

exec "$@"
