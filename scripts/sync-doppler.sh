#!/usr/bin/env bash
# ==============================================================================
# Doppler Secret Manager Sync Script
# Synchronizes environment variables between local .env and Doppler project configs.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PROJECT="cosmos"
COMMAND="${1:-pull}"
CONFIG="${2:-prd}"

if ! command -v doppler >/dev/null 2>&1; then
    echo "[doppler] ERROR: 'doppler' CLI is not installed in PATH." >&2
    exit 1
fi

if ! doppler me >/dev/null 2>&1; then
    echo "[doppler] ERROR: Doppler CLI is not logged in. Run 'doppler login' first." >&2
    exit 1
fi

case "${COMMAND}" in
    pull)
        echo "[doppler] Pulling secrets from project '${PROJECT}' [${CONFIG}] into .env..."
        doppler secrets download --project "${PROJECT}" --config "${CONFIG}" --format env --no-file > .env
        echo "[doppler] SUCCESS: .env has been populated with secrets from Doppler (${PROJECT}:${CONFIG})."
        ;;
    push)
        if [ ! -f ".env" ]; then
            echo "[doppler] ERROR: .env file not found. Nothing to push." >&2
            exit 1
        fi
        echo "[doppler] Uploading local .env secrets to project '${PROJECT}' [${CONFIG}]..."
        doppler secrets upload .env --project "${PROJECT}" --config "${CONFIG}"
        echo "[doppler] SUCCESS: Secrets uploaded to Doppler (${PROJECT}:${CONFIG})."
        ;;
    status)
        echo "[doppler] Active Doppler Workplace and Account:"
        doppler me
        echo ""
        echo "[doppler] Configs in project '${PROJECT}':"
        doppler configs --project "${PROJECT}"
        echo ""
        echo "[doppler] Secrets overview in [dev]:"
        doppler secrets --project "${PROJECT}" --config dev --only-names
        echo ""
        echo "[doppler] Secrets overview in [prd]:"
        doppler secrets --project "${PROJECT}" --config prd --only-names
        ;;
    setup)
        echo "[doppler] Ensuring project '${PROJECT}' exists..."
        if ! doppler projects --json 2>/dev/null | grep -q "\"name\": \"${PROJECT}\""; then
            echo "[doppler] Creating project '${PROJECT}'..."
            doppler projects create "${PROJECT}"
        else
            echo "[doppler] Project '${PROJECT}' already exists."
        fi

        if [ -f ".env" ]; then
            echo "[doppler] Uploading current .env secrets to [prd] and [dev]..."
            doppler secrets upload .env --project "${PROJECT}" --config prd
            doppler secrets upload .env --project "${PROJECT}" --config dev
            echo "[doppler] Secrets successfully populated for dev and prd."
        else
            echo "[doppler] Notice: No local .env found to push. Configs are ready."
        fi
        echo "[doppler] Setup complete for project '${PROJECT}'."
        ;;
    *)
        echo "Usage: $0 {pull|push|status|setup} [prd|dev]"
        exit 1
        ;;
esac
