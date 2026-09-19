#!/usr/bin/env bash
# ==============================================================================
# Cosmos Single-Container Production Guided Deploy Script
# Enforces AGENTS.md rules AA & Z:
# Pre-flight -> Build -> Up (recreate on image change) -> Dynamic verification.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SERVICE="cosmos-all-in-one"
CONTAINER="cosmos-all-in-one"
IMAGE="cosmos:prd"

# ------------------------------------------------------------------------------
# Privilege & Docker Execution Helper
# ------------------------------------------------------------------------------
detect_docker_runner() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "not_found"
        return
    fi
    if docker info >/dev/null 2>&1; then
        echo "direct"
    elif command -v sg >/dev/null 2>&1 && sg docker -c "docker info" >/dev/null 2>&1; then
        echo "sg"
    elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
        echo "sudo"
    else
        echo "direct"
    fi
}

DOCKER_RUNNER="$(detect_docker_runner)"

if [ "${DOCKER_RUNNER}" = "not_found" ]; then
    echo "[deploy] ERROR: 'docker' command is not found in PATH." >&2
    echo "[deploy] Please install Docker and Docker Compose before running this script." >&2
    exit 1
fi

run_docker() {
    case "${DOCKER_RUNNER}" in
        sg)
            sg docker -c "$(printf '%q ' "$@")"
            ;;
        sudo)
            sudo "$@"
            ;;
        *)
            "$@"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Pre-flight: Worktrees, Storage, and Disk
# ------------------------------------------------------------------------------
ensure_worktrees() {
    echo "[deploy] Verifying Git worktrees for API and Website..."
    mkdir -p .worktrees

    if [ ! -f ".worktrees/website/package.json" ]; then
        echo "[deploy] Setting up .worktrees/website worktree..."
        git worktree add --detach .worktrees/website origin/website 2>/dev/null || \
            git worktree add --detach .worktrees/website website 2>/dev/null || \
            git worktree repair .worktrees/website 2>/dev/null || true
    fi

    if [ ! -f ".worktrees/api/package.json" ]; then
        echo "[deploy] Setting up .worktrees/api worktree..."
        git worktree add --detach .worktrees/api origin/api 2>/dev/null || \
            git worktree add --detach .worktrees/api api 2>/dev/null || \
            git worktree repair .worktrees/api 2>/dev/null || true
    fi
}

prepare_storage() {
    echo "[deploy] Ensuring host storage directory and permissions..."
    mkdir -p storage/logs storage/auth_info_baileys
    chmod -R 775 storage 2>/dev/null || true
}

check_disk() {
    echo "[deploy] Disk check..."
    df -h / | tail -n 1
    local use_pct
    use_pct=$(df / --output=pcent 2>/dev/null | tail -n 1 | tr -dc '0-9' || echo "0")
    if [ -n "${use_pct}" ] && [ "${use_pct}" -ge 90 ]; then
        echo "[deploy] Disk use at ${use_pct}% - pruning builder cache first..."
        run_docker docker builder prune -f || true
    fi
}

check_env() {
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        echo "[deploy] Warning: .env not found. Creating .env from .env.example..."
        cp .env.example .env
    fi
}

setup_tunnel() {
    if [ -f "./scripts/setup-cloudflare-tunnel.sh" ]; then
        echo "[deploy] Checking and configuring Cloudflare Tunnel..."
        bash ./scripts/setup-cloudflare-tunnel.sh "${APP_DOMAIN:-cosmos.razael-fox.my.id}" "http://127.0.0.1:8080"
    fi
}

check_disk
ensure_worktrees
prepare_storage
check_env
setup_tunnel

# ------------------------------------------------------------------------------
# Build and Image Comparison
# ------------------------------------------------------------------------------
OLD_IMG=$(run_docker docker inspect "${CONTAINER}" --format '{{.Image}}' 2>/dev/null || echo "none")
IS_RUNNING=$(run_docker docker inspect "${CONTAINER}" --format '{{.State.Running}}' 2>/dev/null || echo "false")

echo "[deploy] Building ${SERVICE}..."
run_docker docker compose build "${SERVICE}" "$@"

LATEST_IMG=$(run_docker docker images --no-trunc "${IMAGE}" --format '{{.ID}}')

if [ "${IS_RUNNING}" != "true" ] || [ "${OLD_IMG}" != "${LATEST_IMG}" ]; then
    echo "[deploy] Image changed (${OLD_IMG} -> ${LATEST_IMG}) or container stopped - recreating container..."
    run_docker docker compose up -d --remove-orphans --force-recreate
else
    echo "[deploy] Container is already running on the latest image (${LATEST_IMG}). Ensuring container is up..."
    run_docker docker compose up -d --remove-orphans
fi

# ------------------------------------------------------------------------------
# Health Verification Polling
# ------------------------------------------------------------------------------
echo "[deploy] Verifying container startup and service health..."
MAX_WAIT_SECONDS=45
START_TIME=$(date +%s)
HEALTHY=0

while [ $(( $(date +%s) - START_TIME )) -lt "${MAX_WAIT_SECONDS}" ]; do
    CURRENT_RUNNING=$(run_docker docker inspect "${CONTAINER}" --format '{{.State.Running}}' 2>/dev/null || echo "false")
    if [ "${CURRENT_RUNNING}" != "true" ]; then
        echo "[deploy] Container stopped unexpectedly during boot. Fetching logs..."
        run_docker docker logs "${CONTAINER}" --tail 40 || true
        exit 1
    fi

    # Probe loopback ingress
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8080/healthz 2>/dev/null || \
                curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8080/ 2>/dev/null || echo "000")

    case "${HTTP_CODE}" in
        200|301|302|307|308|404)
            HEALTHY=1
            break
            ;;
        *)
            sleep 2
            ;;
    esac
done

if [ "${HEALTHY}" -eq 1 ]; then
    ELAPSED=$(( $(date +%s) - START_TIME ))
    echo "[deploy] Container is healthy! Responded in ${ELAPSED}s."
else
    echo "[deploy] WARNING: Container healthcheck timed out after ${MAX_WAIT_SECONDS}s."
    echo "[deploy] Displaying recent container logs:"
    run_docker docker logs "${CONTAINER}" --tail 40 || true
    exit 1
fi

echo "[deploy] Active PM2 Process List:"
run_docker docker exec "${CONTAINER}" /usr/local/bin/pm2 list 2>/dev/null || true

echo ""
echo "[deploy] Deployment complete!"
echo "[deploy] Endpoints:"
echo "  - Local / Host Ingress: http://127.0.0.1:8080 (or http://192.168.11.86:8080)"
echo "  - NAT VPS Public URL:   http://38.49.212.111:1623"
echo "  - Cloudflare Tunnel:    https://cosmos.razael-fox.my.id (if configured)"
echo "[deploy] Tail logs anytime with: pnpm docker:logs"
