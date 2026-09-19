#!/usr/bin/env bash
# ==============================================================================
# Cloudflare Turnstile Widget Automation Script
# Creates a Turnstile widget via Cloudflare REST API and updates .env.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DEFAULT_ACCOUNT_ID="aecab5f78acb207a192a9ca4c5b80b45"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$DEFAULT_ACCOUNT_ID}"
API_TOKEN="${1:-${CLOUDFLARE_API_TOKEN:-}}"
WIDGET_NAME="${2:-Cosmos Web Portal}"

if [ -z "${API_TOKEN}" ]; then
    echo "======================================================================"
    echo "[turnstile] Cloudflare Turnstile Widget Provisioning Helper"
    echo "======================================================================"
    echo "Usage:"
    echo "  $0 <CLOUDFLARE_API_TOKEN> [WIDGET_NAME]"
    echo ""
    echo "Or provide environment variables:"
    echo "  CLOUDFLARE_API_TOKEN='...' $0"
    echo ""
    echo "Requirements for Cloudflare API Token:"
    echo "  - Account.Turnstile (Edit)"
    echo ""
    echo "Default Account ID detected from tunnel: ${ACCOUNT_ID}"
    echo "Allowed Domains will be set to: cosmos.razael-fox.my.id, 38.49.212.111, localhost"
    echo "======================================================================"
    exit 1
fi

echo "[turnstile] Creating Turnstile widget '${WIDGET_NAME}' under Account: ${ACCOUNT_ID}..."

PAYLOAD=$(cat <<EOF
{
  "name": "${WIDGET_NAME}",
  "domains": [
    "cosmos.razael-fox.my.id",
    "razael-fox.my.id",
    "38.49.212.111",
    "localhost"
  ],
  "mode": "managed",
  "bot_fight_mode": false
}
EOF
)

RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/turnstile/widgets" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}")

SUCCESS=$(echo "${RESPONSE}" | grep -o '"success":true' || echo "")

if [ -z "${SUCCESS}" ]; then
    echo "[turnstile] ERROR: Failed to create Turnstile widget from Cloudflare API."
    echo "[turnstile] Response details:"
    echo "${RESPONSE}"
    exit 1
fi

SITEKEY=$(echo "${RESPONSE}" | grep -o '"sitekey":"[^"]*' | cut -d '"' -f 4 || echo "")
SECRET=$(echo "${RESPONSE}" | grep -o '"secret":"[^"]*' | cut -d '"' -f 4 || echo "")

if [ -z "${SITEKEY}" ] || [ -z "${SECRET}" ]; then
    echo "[turnstile] ERROR: Could not parse sitekey or secret from response:"
    echo "${RESPONSE}"
    exit 1
fi

echo "======================================================================"
echo "[turnstile] SUCCESS: Cloudflare Turnstile widget created successfully!"
echo "  - Site Key (Public):  ${SITEKEY}"
echo "  - Secret Key:         ${SECRET:0:10}****************"
echo "======================================================================"

# Automatically sync into .env
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
fi

if [ -f ".env" ]; then
    # Update NEXT_PUBLIC_TURNSTILE_SITE_KEY
    if grep -q "^NEXT_PUBLIC_TURNSTILE_SITE_KEY=" .env; then
        sed -i "s|^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.*|NEXT_PUBLIC_TURNSTILE_SITE_KEY=\"${SITEKEY}\"|" .env
    else
        echo "NEXT_PUBLIC_TURNSTILE_SITE_KEY=\"${SITEKEY}\"" >> .env
    fi

    # Update CLOUDFLARE_TURNSTILE_SECRET_KEY
    if grep -q "^CLOUDFLARE_TURNSTILE_SECRET_KEY=" .env; then
        sed -i "s|^CLOUDFLARE_TURNSTILE_SECRET_KEY=.*|CLOUDFLARE_TURNSTILE_SECRET_KEY=\"${SECRET}\"|" .env
    else
        echo "CLOUDFLARE_TURNSTILE_SECRET_KEY=\"${SECRET}\"" >> .env
    fi

    echo "[turnstile] .env has been automatically updated with the new Turnstile keys."
    echo "[turnstile] NOTE: Since NEXT_PUBLIC_TURNSTILE_SITE_KEY is embedded at build time,"
    echo "[turnstile] run './scripts/docker-deploy.sh' to rebuild the production image with the new key."
fi
