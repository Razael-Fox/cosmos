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
    echo "[docker-dev] ERROR: 'docker' command is not found in PATH." >&2
    echo "[docker-dev] Please install Docker and Docker Compose before running this script." >&2
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
# Worktree, Storage, and Environment Verification
# ------------------------------------------------------------------------------
ensure_worktrees() {
    echo "[docker-dev] Verifying Git worktrees for API and Website..."
    mkdir -p .worktrees

    if [ ! -f ".worktrees/website/package.json" ]; then
        echo "[docker-dev] Setting up .worktrees/website worktree..."
        git worktree add --detach .worktrees/website origin/website 2>/dev/null || \
            git worktree add --detach .worktrees/website website 2>/dev/null || \
            git worktree repair .worktrees/website 2>/dev/null || true
    fi

    if [ ! -f ".worktrees/api/package.json" ]; then
        echo "[docker-dev] Setting up .worktrees/api worktree..."
        git worktree add --detach .worktrees/api origin/api 2>/dev/null || \
            git worktree add --detach .worktrees/api api 2>/dev/null || \
            git worktree repair .worktrees/api 2>/dev/null || true
    fi
}

prepare_storage() {
    mkdir -p storage/logs storage/auth_info_baileys
    chmod -R 775 storage 2>/dev/null || true
}

check_env() {
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        echo "[docker-dev] Notice: .env not found. Creating default .env from .env.example..."
        cp .env.example .env
    fi
}

# ------------------------------------------------------------------------------
# Asynchronous Multi-Service Build
# ------------------------------------------------------------------------------
build_async() {
    echo "[docker-dev] Checking disk space before build..."
    local use_pct
    use_pct=$(df / --output=pcent 2>/dev/null | tail -n 1 | tr -dc '0-9' || echo "0")
    if [ -n "${use_pct}" ] && [ "${use_pct}" -ge 90 ]; then
        echo "[docker-dev] Warning: Low disk space (${use_pct}% used). Pruning build cache..."
        run_docker docker builder prune -f || true
    fi

    ensure_worktrees
    prepare_storage
    check_env

    local targets=("$@")
    if [ "${#targets[@]}" -eq 0 ]; then
        targets=("${SERVICES[@]}")
    fi

    echo "======================================================================"
    echo "[docker-dev] Launching ASYNCHRONOUS builds for: ${targets[*]}"
    echo "[docker-dev] Tasks will execute concurrently and stream logs."
    echo "======================================================================"

    local pids=()
    local temp_dir
    temp_dir="$(mktemp -d /tmp/cosmos-docker-dev-build.XXXXXX)"

    for svc in "${targets[@]}"; do
        local status_file="${temp_dir}/${svc}.exit"
        (
            echo "[build:${svc}] Async build process started..."
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

    local failed=0
    for idx in "${!pids[@]}"; do
        local pid="${pids[$idx]}"
        local svc="${targets[$idx]}"
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
    echo "[docker-dev] All requested service Docker images built successfully!"
    echo "======================================================================"
}

# ------------------------------------------------------------------------------
# Container Lifecycle Handlers
# ------------------------------------------------------------------------------
up() {
    ensure_worktrees
    prepare_storage
    check_env
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
    ensure_worktrees
    prepare_storage
    check_env

    # If bot container is already running, exec into it; otherwise run an ephemeral instance
    local is_running
    is_running=$(run_docker docker compose -f "${COMPOSE_FILE}" ps -q bot 2>/dev/null || echo "")
    if [ -n "${is_running}" ]; then
        echo "[docker-dev] Bot container is already running. Attaching pairing session via exec..."
        run_docker docker compose -f "${COMPOSE_FILE}" exec bot pnpm pair
    else
        echo "[docker-dev] Bot container is not running. Starting ephemeral pairing container..."
        run_docker docker compose -f "${COMPOSE_FILE}" run --rm bot pnpm pair
    fi
}

clean() {
    echo "[docker-dev] Cleaning development containers and dangling volumes..."
    run_docker docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans || true
    echo "[docker-dev] Clean complete."
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
    echo "  - Build all / one:      ./scripts/docker-dev.sh build [bot|api|web]"
    echo "  - Start all / one:      ./scripts/docker-dev.sh up [bot|api|web]"
    echo "  - Restart all / one:    ./scripts/docker-dev.sh restart [bot|api|web]"
    echo "  - Tail all logs:        ./scripts/docker-dev.sh logs"
    echo "  - Tail service logs:    ./scripts/docker-dev.sh logs [bot|api|web]"
    echo "  - Pair WhatsApp bot:    ./scripts/docker-dev.sh pair"
    echo "  - Clean containers:     ./scripts/docker-dev.sh clean"
    echo "  - Stop dev servers:     ./scripts/docker-dev.sh down"
}

# ------------------------------------------------------------------------------
# CLI Dispatcher
# ------------------------------------------------------------------------------
COMMAND="${1:-dev}"
shift 1 || true

case "${COMMAND}" in
    build)
        build_async "$@"
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
    clean)
        clean
        ;;
    status|ps)
        status
        ;;
    dev)
        build_async
        up
        ;;
    *)
        echo "Usage: $0 {build|up|down|restart|logs|pair|clean|status|dev} [service...|args...]"
        exit 1
        ;;
esac
