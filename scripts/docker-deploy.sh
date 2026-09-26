#!/usr/bin/env bash
# ==============================================================================
# Cosmos Single-Container Production Guided Deploy Script
# Enforces AGENTS.md rules AA & Z:
# Pre-flight -> Build -> Up (recreate on image change) -> Dynamic verification.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SERVICE="cosmos-origin"
CONTAINER="cosmos-origin"
IMAGE="cosmos-origin:latest"

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
    chmod -R 777 storage 2>/dev/null || true
}

check_disk() {
    echo "[deploy] Disk check..."
    df -h / | tail -n 1
    local use_pct
    use_pct=$(df / --output=pcent 2>/dev/null | tail -n 1 | tr -dc '0-9' || echo "0")
    if [ -n "${use_pct}" ] && [ "${use_pct}" -ge 80 ]; then
        echo "[deploy] Disk use at ${use_pct}% - trimming builder cache and dangling images..."
        run_docker docker image prune -f || true
        run_docker docker builder prune -f --reserved-space 1GB || true
    fi
}

cleanup_after_deploy() {
    echo "[deploy] Cleaning up old images and build cache..."
    if [ -n "${OLD_IMG:-}" ] && [ "${OLD_IMG}" != "none" ] && [ "${OLD_IMG}" != "${LATEST_IMG}" ]; then
        echo "[deploy] Pruning previous container image (${OLD_IMG})..."
        run_docker docker rmi "${OLD_IMG}" 2>/dev/null || true
    fi
    run_docker docker image prune -f || true
    run_docker docker builder prune -f --reserved-space 2GB || true
}

check_env() {
    if command -v doppler >/dev/null 2>&1 && doppler me >/dev/null 2>&1; then
        echo "[deploy] Doppler detected and authenticated! Pulling latest 'prd' secrets from project 'cosmos'..."
        doppler secrets download --project cosmos --config prd --format env --no-file > .env 2>/dev/null || true
    fi

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
if run_docker docker inspect --type container "${CONTAINER}" >/dev/null 2>&1; then
    OLD_IMG=$(run_docker docker inspect --type container "${CONTAINER}" --format '{{.Image}}' | tr -d '[:space:]')
    IS_RUNNING=$(run_docker docker inspect --type container "${CONTAINER}" --format '{{.State.Running}}' | tr -d '[:space:]')
else
    OLD_IMG="none"
    IS_RUNNING="false"
fi

echo "[deploy] Building ${SERVICE}..."
run_docker docker compose build "${SERVICE}" "$@"

LATEST_IMG=$(run_docker docker images --no-trunc "${IMAGE}" --format '{{.ID}}' | tr -d '[:space:]')

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
    if run_docker docker inspect "${CONTAINER}" >/dev/null 2>&1; then
        CURRENT_RUNNING=$(run_docker docker inspect "${CONTAINER}" --format '{{.State.Running}}' | tr -d '[:space:]')
    else
        CURRENT_RUNNING="false"
    fi
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

cleanup_after_deploy
echo ""
echo "[deploy] Deployment complete!"
echo "[deploy] Endpoints:"
echo "  - Local / Host Ingress: http://127.0.0.1:${HOST_PORT_ALL_IN_ONE:-8080}"
if [ -n "${APP_DOMAIN:-}" ]; then
    echo "  - Public / Domain:      https://${APP_DOMAIN}"
fi
echo "[deploy] Tail logs anytime with: pnpm docker:logs"
