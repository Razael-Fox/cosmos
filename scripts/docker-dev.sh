#!/usr/bin/env bash
# ==============================================================================
# Cosmos Development Server Docker Management Script
# Provides asynchronous, concurrent multi-service builds and container lifecycle.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker-compose.dev.yml"
SERVICES=("bot" "api" "web")

# ------------------------------------------------------------------------------
# Privilege & Docker Execution Helper
# ------------------------------------------------------------------------------
detect_docker_runner() {
    if docker info >/dev/null 2>&1; then
        echo "direct"
    elif sg docker -c "docker info" >/dev/null 2>&1; then
        echo "sg"
    elif sudo -n docker info >/dev/null 2>&1; then
        echo "sudo"
    else
        echo "direct"
    fi
}

DOCKER_RUNNER="$(detect_docker_runner)"

run_docker() {
    case "${DOCKER_RUNNER}" in
        sg)
            sg docker -c "$*"
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
    echo "[docker-dev] Verifying Git worktrees for API and Website..."
    if [ ! -d ".worktrees/website" ]; then
        echo "[docker-dev] Setting up .worktrees/website worktree..."
        mkdir -p .worktrees
        git worktree add --detach .worktrees/website origin/website 2>/dev/null || \
            git worktree add --detach .worktrees/website website 2>/dev/null || true
    fi

    if [ ! -d ".worktrees/api" ]; then
        echo "[docker-dev] Setting up .worktrees/api worktree..."
        mkdir -p .worktrees
        git worktree add --detach .worktrees/api origin/api 2>/dev/null || \
            git worktree add --detach .worktrees/api api 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# Asynchronous Multi-Service Build
# ------------------------------------------------------------------------------
build_async() {
    echo "[docker-dev] Checking disk space before build..."
    local avail_gb
    avail_gb=$(df -BG "${ROOT_DIR}" | awk 'NR==2 {gsub(/G/,"",$4); print $4}')
    if [ "${avail_gb}" -lt 5 ]; then
        echo "[docker-dev] Warning: Low disk space (${avail_gb}GB remaining). Pruning build cache..."
        run_docker docker builder prune -f || true
    fi

    ensure_worktrees

    echo "======================================================================"
    echo "[docker-dev] Launching ASYNCHRONOUS builds for: ${SERVICES[*]}"
    echo "[docker-dev] Tasks will execute concurrently and stream logs alternately."
    echo "======================================================================"

    local pids=()
    local temp_dir
    temp_dir="$(mktemp -d /tmp/cosmos-docker-dev-build.XXXXXX)"

    for svc in "${SERVICES[@]}"; do
        local status_file="${temp_dir}/${svc}.exit"
        (
            echo "[build:${svc}] Async build process started..."
            # Execute docker build targeting the specific service
            if run_docker docker compose -f "${COMPOSE_FILE}" build "${svc}" 2>&1 | while IFS= read -r line; do
                printf "[build:%s] %s\n" "${svc}" "${line}"
            done; then
                echo 0 > "${status_file}"
                echo "[build:${svc}] Async build completed successfully."
            else
                echo 1 > "${status_file}"
                echo "[build:${svc}] Async build FAILED!"
            fi
        ) &
        pids+=($!)
        echo "[docker-dev] Launched build for '${svc}' in background (Job PID: ${pids[-1]})"
    done

    echo "[docker-dev] All background build processes initiated. Awaiting completion..."

    # Wait for each asynchronous background process
    local failed=0
    for idx in "${!pids[@]}"; do
        local pid="${pids[$idx]}"
        local svc="${SERVICES[$idx]}"
        wait "${pid}" || failed=1
        local exit_code=0
        if [ -f "${temp_dir}/${svc}.exit" ]; then
            exit_code=$(cat "${temp_dir}/${svc}.exit")
        fi
        if [ "${exit_code}" -ne 0 ]; then
            echo "[docker-dev] ERROR: Service '${svc}' encountered a build failure."
            failed=1
        else
            echo "[docker-dev] SUCCESS: Service '${svc}' built successfully."
        fi
    done

    rm -rf "${temp_dir}"

    if [ "${failed}" -ne 0 ]; then
        echo "======================================================================"
        echo "[docker-dev] Build failed for one or more services. Please inspect errors above."
        echo "======================================================================"
        return 1
    fi

    echo "======================================================================"
    echo "[docker-dev] All service Docker images built successfully in parallel!"
    echo "======================================================================"
}

# ------------------------------------------------------------------------------
# Container Lifecycle Handlers
# ------------------------------------------------------------------------------
up() {
    ensure_worktrees
    echo "[docker-dev] Starting development containers in background..."
    run_docker docker compose -f "${COMPOSE_FILE}" up -d "$@"
    echo "[docker-dev] Development services are now up."
    status
}

down() {
    echo "[docker-dev] Stopping development containers..."
    run_docker docker compose -f "${COMPOSE_FILE}" down "$@"
}

restart() {
    echo "[docker-dev] Restarting development containers..."
    run_docker docker compose -f "${COMPOSE_FILE}" restart "$@"
    echo "[docker-dev] Restart complete."
    status
}

logs() {
    run_docker docker compose -f "${COMPOSE_FILE}" logs -f "$@"
}

pair() {
    echo "[docker-dev] Launching interactive WhatsApp pairing session..."
    run_docker docker compose -f "${COMPOSE_FILE}" run --rm bot pnpm pair
}

status() {
    echo "[docker-dev] Container Status:"
    run_docker docker compose -f "${COMPOSE_FILE}" ps
    echo ""
    echo "[docker-dev] Endpoints:"
    echo "  - Web Portal:    http://localhost:3000"
    echo "  - API Gateway:   http://localhost:4000"
    echo "  - WhatsApp Bot:  Interactive / Socket (/app/storage/ipc.sock)"
    echo ""
    echo "[docker-dev] Useful commands:"
    echo "  - Restart all / one:    ./scripts/docker-dev.sh restart [bot|api|web]"
    echo "  - Tail all logs:        ./scripts/docker-dev.sh logs"
    echo "  - Tail service logs:    ./scripts/docker-dev.sh logs [bot|api|web]"
    echo "  - Pair WhatsApp bot:    ./scripts/docker-dev.sh pair"
    echo "  - Stop dev servers:     ./scripts/docker-dev.sh down"
}

# ------------------------------------------------------------------------------
# CLI Dispatcher
# ------------------------------------------------------------------------------
COMMAND="${1:-dev}"
shift 1 || true

case "${COMMAND}" in
    build)
        build_async
        ;;
    up|start)
        up "$@"
        ;;
    down|stop)
        down "$@"
        ;;
    restart)
        restart "$@"
        ;;
    logs)
        logs "$@"
        ;;
    pair)
        pair
        ;;
    status|ps)
        status
        ;;
    dev)
        build_async
        up
        ;;
    *)
        echo "Usage: $0 {build|up|down|restart|logs|pair|status|dev} [args...]"
        exit 1
        ;;
esac
