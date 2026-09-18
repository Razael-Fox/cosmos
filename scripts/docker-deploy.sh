#!/usr/bin/env bash
# Cosmos single-container guided deploy (see AGENTS.md rule AA/Z).
# Build -> up -> recreate only when the image changed -> verify live.
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="cosmos-all-in-one"
CONTAINER="cosmos-all-in-one"

echo "[deploy] Disk check..."
df -h / | tail -n 1
USE_PCT=$(df / --output=pcent | tail -n 1 | tr -dc '0-9')
if [ "${USE_PCT}" -ge 90 ]; then
    echo "[deploy] Disk use at ${USE_PCT}% - pruning builder cache first..."
    docker builder prune -f
fi

echo "[deploy] Building ${SERVICE}..."
docker compose build "${SERVICE}"

echo "[deploy] Starting..."
docker compose up -d

RUNNING_IMG=$(docker inspect "${CONTAINER}" --format '{{.Image}}')
LATEST_IMG=$(docker images --no-trunc "${SERVICE}:latest" --format '{{.ID}}')
if [ "${RUNNING_IMG}" != "${LATEST_IMG}" ]; then
    echo "[deploy] Image changed (${LATEST_IMG}) - recreating container..."
    docker compose up -d --force-recreate
    echo "[deploy] Waiting for services to boot..."
    sleep 30
else
    echo "[deploy] Container already on latest image."
fi

echo "[deploy] Verifying..."
docker exec "${CONTAINER}" /usr/local/bin/pm2 list | grep -E "cosmos-(bot|api|web|nginx|tunnel)"
curl -s -o /dev/null -w "dashboard:%{http_code}\n" --max-time 20 http://127.0.0.1:8080/dashboard
echo "[deploy] Done. Tail logs with: pnpm docker:logs"
