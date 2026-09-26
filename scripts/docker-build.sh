#!/usr/bin/env bash
# ==============================================================================
# Cosmos Single-Container Docker Build Script
# Prepares worktrees, checks disk space, and builds cosmos-origin with Compose.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SERVICE="cosmos-origin"
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
    echo "[docker-build] ERROR: 'docker' command is not found in PATH." >&2
    echo "[docker-build] Please install Docker and Docker Compose before running this script." >&2
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
# Worktree Verification
# ------------------------------------------------------------------------------
ensure_worktrees() {
    echo "[docker-build] Verifying Git worktrees for API and Website..."
    mkdir -p .worktrees

    if [ ! -f ".worktrees/website/package.json" ]; then
        echo "[docker-build] Setting up .worktrees/website worktree..."
        git worktree add --detach .worktrees/website origin/website 2>/dev/null || \
            git worktree add --detach .worktrees/website website 2>/dev/null || \
            git worktree repair .worktrees/website 2>/dev/null || true
    fi

    if [ ! -f ".worktrees/api/package.json" ]; then
        echo "[docker-build] Setting up .worktrees/api worktree..."
        git worktree add --detach .worktrees/api origin/api 2>/dev/null || \
            git worktree add --detach .worktrees/api api 2>/dev/null || \
            git worktree repair .worktrees/api 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# Pre-build Disk Space Check
# ------------------------------------------------------------------------------
check_disk_space() {
    echo "[docker-build] Checking disk space before build..."
    local use_pct
    use_pct=$(df / --output=pcent 2>/dev/null | tail -n 1 | tr -dc '0-9' || echo "0")
    if [ -n "${use_pct}" ] && [ "${use_pct}" -ge 80 ]; then
        echo "[docker-build] Warning: Disk usage at ${use_pct}%. Trimming builder cache and dangling images..."
        run_docker docker image prune -f || true
        run_docker docker builder prune -f --reserved-space 1GB || true
    fi
}

cleanup_after_build() {
    echo "[docker-build] Post-build cleanup: pruning dangling images and trimming builder cache..."
    run_docker docker image prune -f || true
    run_docker docker builder prune -f --reserved-space 2GB || true
}

# ------------------------------------------------------------------------------
# Environment & Doppler Secret Management
# ------------------------------------------------------------------------------
check_env() {
    local config="${DOPPLER_CONFIG:-prd}"
    if command -v doppler >/dev/null 2>&1 && doppler me >/dev/null 2>&1; then
        echo "[docker-build] Doppler detected and authenticated! Pulling latest '${config}' secrets from project 'cosmos'..."
        doppler secrets download --project cosmos --config "${config}" --format env --no-file > .env 2>/dev/null || true
    fi

    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        echo "[docker-build] Notice: .env not found. Creating default .env from .env.example..."
        cp .env.example .env
    fi
}

# ------------------------------------------------------------------------------
# Main Build Execution
# ------------------------------------------------------------------------------
check_disk_space
ensure_worktrees
check_env

echo "[docker-build] Building image for service: ${SERVICE}..."
if run_docker docker compose version >/dev/null 2>&1; then
    run_docker docker compose build "${SERVICE}" "$@"
else
    # Fallback to docker build directly if compose plugin is unavailable
    echo "[docker-build] docker compose unavailable, falling back to docker build..."
    run_docker docker build -f docker/Dockerfile -t "${IMAGE}" "$@" .
fi
cleanup_after_build

echo "[docker-build] Build complete: ${IMAGE} is ready."
