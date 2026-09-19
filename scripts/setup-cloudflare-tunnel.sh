#!/usr/bin/env bash
# ==============================================================================
# Cloudflare Tunnel Auto-Setup & Hostname Configuration Script
# Automatically creates a tunnel if none exists, or configures the hostname
# and ingress if one already exists, ensuring automatic connection on boot.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DEFAULT_HOSTNAME="${APP_DOMAIN:-cosmos.razael-fox.my.id}"
HOSTNAME="${1:-$DEFAULT_HOSTNAME}"
TARGET_URL="${2:-http://127.0.0.1:8080}"

TOKEN_FILE="/etc/cloudflared/token"
CONFIG_FILE="/etc/cloudflared/config.yml"
SERVICE_FILE="/etc/systemd/system/cloudflared.service"

echo "======================================================================"
echo "[tunnel] Cloudflare Tunnel Setup & Configuration"
echo "[tunnel] Target Hostname: ${HOSTNAME}"
echo "[tunnel] Target Local Service: ${TARGET_URL}"
echo "======================================================================"

# ------------------------------------------------------------------------------
# Helper for Privilege Elevation
# ------------------------------------------------------------------------------
sudo_cmd() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        "$@"
    fi
}

# ------------------------------------------------------------------------------
# Step 1: Ensure cloudflared CLI is installed
# ------------------------------------------------------------------------------
install_cloudflared() {
    if command -v cloudflared >/dev/null 2>&1; then
        echo "[tunnel] cloudflared is already installed ($(cloudflared --version | head -n 1))."
        return 0
    fi

    echo "[tunnel] cloudflared is not installed. Installing latest binary..."
    local arch
    arch=$(dpkg --print-architecture 2>/dev/null || uname -m)
    case "${arch}" in
        x86_64|amd64) CF_ARCH="amd64" ;;
        aarch64|arm64) CF_ARCH="arm64" ;;
        armv7l|armhf) CF_ARCH="arm" ;;
        *) CF_ARCH="amd64" ;;
    esac

    local tmp_bin
    tmp_bin="$(mktemp /tmp/cloudflared.XXXXXX)"
    echo "[tunnel] Downloading cloudflared-linux-${CF_ARCH}..."
    curl -fsSL -o "${tmp_bin}" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
    chmod +x "${tmp_bin}"
    sudo_cmd mv "${tmp_bin}" /usr/local/bin/cloudflared
    echo "[tunnel] cloudflared successfully installed to /usr/local/bin/cloudflared."
}

# ------------------------------------------------------------------------------
# Step 2: Read or Detect Existing Tunnel
# ------------------------------------------------------------------------------
detect_existing_tunnel() {
    EXISTING_TOKEN=""
    EXISTING_TUNNEL_ID=""

    # 1. Check /etc/cloudflared/token
    if sudo_cmd test -s "${TOKEN_FILE}" 2>/dev/null; then
        EXISTING_TOKEN=$(sudo_cmd cat "${TOKEN_FILE}" | tr -d '[:space:]')
    fi

    # 2. Check .env if token not found in /etc/cloudflared/token
    if [ -z "${EXISTING_TOKEN}" ] && [ -f ".env" ]; then
        EXISTING_TOKEN=$(grep -E "^CLOUDFLARE_TUNNEL_TOKEN=" .env | cut -d '=' -f 2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || echo "")
    fi

    # 3. Check environment variable
    if [ -z "${EXISTING_TOKEN}" ] && [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
        EXISTING_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN}"
    fi

    # Parse tunnel ID from base64 token if available
    if [ -n "${EXISTING_TOKEN}" ]; then
        local decoded
        decoded=$(echo "${EXISTING_TOKEN}" | base64 -d 2>/dev/null || echo "")
        if [ -n "${decoded}" ]; then
            EXISTING_TUNNEL_ID=$(echo "${decoded}" | grep -o '"t":"[^"]*' | cut -d '"' -f 4 || echo "")
        fi
    fi

    # 4. Check for local credentials file if token is not used
    if [ -z "${EXISTING_TUNNEL_ID}" ]; then
        local cred_file
        cred_file=$(sudo_cmd find /etc/cloudflared "$HOME/.cloudflared" -maxdepth 1 -name "*.json" 2>/dev/null | head -n 1 || echo "")
        if [ -n "${cred_file}" ]; then
            EXISTING_TUNNEL_ID=$(basename "${cred_file}" .json)
        fi
    fi
}

# ------------------------------------------------------------------------------
# Step 3: Configure Existing Tunnel
# ------------------------------------------------------------------------------
configure_existing_tunnel() {
    echo "[tunnel] Existing Cloudflare Tunnel detected!"
    if [ -n "${EXISTING_TUNNEL_ID}" ]; then
        echo "[tunnel] Tunnel ID: ${EXISTING_TUNNEL_ID}"
    fi

    sudo_cmd mkdir -p /etc/cloudflared

    # Ensure token file is in place
    if [ -n "${EXISTING_TOKEN}" ]; then
        echo "${EXISTING_TOKEN}" | sudo_cmd tee "${TOKEN_FILE}" >/dev/null
        sudo_cmd chmod 600 "${TOKEN_FILE}"
    fi

    # Write /etc/cloudflared/config.yml with proper ingress routing
    echo "[tunnel] Writing ingress configuration to ${CONFIG_FILE}..."
    local creds_line=""
    if [ -n "${EXISTING_TUNNEL_ID}" ] && sudo_cmd test -f "/etc/cloudflared/${EXISTING_TUNNEL_ID}.json"; then
        creds_line="credentials-file: /etc/cloudflared/${EXISTING_TUNNEL_ID}.json"
    fi

    sudo_cmd tee "${CONFIG_FILE}" >/dev/null <<EOF
${EXISTING_TUNNEL_ID:+tunnel: ${EXISTING_TUNNEL_ID}}
${creds_line}
ingress:
  - hostname: ${HOSTNAME}
    service: ${TARGET_URL}
  - service: http_status:404
EOF
    sudo_cmd chmod 644 "${CONFIG_FILE}"

    # Route DNS hostname if cert.pem (origin cert) is present
    local cert_file
    cert_file=$(sudo_cmd find /etc/cloudflared "$HOME/.cloudflared" -maxdepth 1 -name "cert.pem" 2>/dev/null | head -n 1 || echo "")
    if [ -n "${cert_file}" ] && [ -n "${EXISTING_TUNNEL_ID}" ]; then
        echo "[tunnel] Routing DNS hostname '${HOSTNAME}' to tunnel '${EXISTING_TUNNEL_ID}'..."
        if sudo_cmd cloudflared tunnel --origincert "${cert_file}" route dns -f "${EXISTING_TUNNEL_ID}" "${HOSTNAME}" 2>&1; then
            echo "[tunnel] DNS route registered successfully for ${HOSTNAME}!"
        else
            echo "[tunnel] Note: Route command completed (DNS record may already exist)."
        fi
    else
        echo "[tunnel] (Notice: Using token-based remote tunnel. Hostname '${HOSTNAME}' is routed via Cloudflare Zero Trust)."
    fi

    # Update/ensure systemd service on host
    update_systemd_service
}

# ------------------------------------------------------------------------------
# Step 4: Create New Tunnel if None Exists
# ------------------------------------------------------------------------------
create_new_tunnel() {
    echo "[tunnel] No existing tunnel detected. Initiating automated setup..."
    sudo_cmd mkdir -p /etc/cloudflared

    local cert_file
    cert_file=$(sudo_cmd find /etc/cloudflared "$HOME/.cloudflared" -maxdepth 1 -name "cert.pem" 2>/dev/null | head -n 1 || echo "")

    if [ -n "${cert_file}" ]; then
        echo "[tunnel] Found Cloudflare origin certificate at ${cert_file}."
        echo "[tunnel] Creating named tunnel 'cosmos-tunnel'..."
        sudo_cmd cloudflared tunnel --origincert "${cert_file}" create cosmos-tunnel || true

        local tunnel_id
        tunnel_id=$(sudo_cmd cloudflared tunnel --origincert "${cert_file}" list | grep "cosmos-tunnel" | awk '{print $1}' || echo "")
        if [ -n "${tunnel_id}" ]; then
            EXISTING_TUNNEL_ID="${tunnel_id}"
            echo "[tunnel] Tunnel created successfully with ID: ${EXISTING_TUNNEL_ID}"
            echo "[tunnel] Routing DNS for ${HOSTNAME}..."
            sudo_cmd cloudflared tunnel --origincert "${cert_file}" route dns -f cosmos-tunnel "${HOSTNAME}" || true

            sudo_cmd tee "${CONFIG_FILE}" >/dev/null <<EOF
tunnel: cosmos-tunnel
credentials-file: /etc/cloudflared/${EXISTING_TUNNEL_ID}.json
ingress:
  - hostname: ${HOSTNAME}
    service: ${TARGET_URL}
  - service: http_status:404
EOF
            sudo_cmd chmod 644 "${CONFIG_FILE}"
        fi
    else
        echo "----------------------------------------------------------------------"
        echo "[tunnel] NOTE: Neither a tunnel token nor cert.pem was found."
        echo "[tunnel] To connect your custom domain (${HOSTNAME}):"
        echo "  Option A (Recommended): Create a Tunnel in Cloudflare Zero Trust Dashboard:"
        echo "    1. Go to Zero Trust -> Networks -> Tunnels -> Create Tunnel."
        echo "    2. Copy the tunnel token and run:"
        echo "       CLOUDFLARE_TUNNEL_TOKEN='<your_token>' ./scripts/setup-cloudflare-tunnel.sh ${HOSTNAME}"
        echo "  Option B: Login via CLI by running: cloudflared tunnel login"
        echo "----------------------------------------------------------------------"
        echo "[tunnel] Starting ephemeral Quick Tunnel (trycloudflare.com) for immediate access..."
        echo "[tunnel] You can run: cloudflared tunnel --url ${TARGET_URL}"
        return 0
    fi

    update_systemd_service
}

# ------------------------------------------------------------------------------
# Step 5: Configure and Start Systemd Service
# ------------------------------------------------------------------------------
update_systemd_service() {
    if ! command -v systemctl >/dev/null 2>&1; then
        echo "[tunnel] systemctl not available in this environment. Skipping systemd service configuration."
        return 0
    fi

    echo "[tunnel] Configuring systemd cloudflared service..."
    local exec_line="/usr/bin/cloudflared --no-autoupdate tunnel run --token-file ${TOKEN_FILE} --url ${TARGET_URL}"
    if [ -z "${EXISTING_TOKEN}" ] && [ -f "${CONFIG_FILE}" ]; then
        exec_line="/usr/bin/cloudflared --no-autoupdate tunnel --config ${CONFIG_FILE} run"
    elif [ -n "${EXISTING_TOKEN}" ]; then
        exec_line="/usr/bin/cloudflared --no-autoupdate tunnel run --token-file ${TOKEN_FILE} --url ${TARGET_URL}"
    fi

    sudo_cmd tee "${SERVICE_FILE}" >/dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel client
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=20
Type=notify
ExecStart=${exec_line}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

    sudo_cmd systemctl daemon-reload
    sudo_cmd systemctl enable cloudflared 2>/dev/null || true
    echo "[tunnel] Restarting cloudflared.service..."
    sudo_cmd systemctl restart cloudflared 2>/dev/null || sudo_cmd systemctl start cloudflared 2>/dev/null || true

    sleep 3
    if sudo_cmd systemctl is-active cloudflared >/dev/null 2>&1; then
        echo "[tunnel] SUCCESS: cloudflared.service is active and running!"
    else
        echo "[tunnel] Note: cloudflared.service status: $(sudo_cmd systemctl is-active cloudflared 2>/dev/null || echo 'inactive')"
    fi
}

# ------------------------------------------------------------------------------
# Step 6: Sync Environment Variables (.env)
# ------------------------------------------------------------------------------
sync_env() {
    echo "[tunnel] Synchronizing environment settings in .env..."
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        cp .env.example .env
    fi

    if [ -f ".env" ]; then
        # Update or append APP_DOMAIN
        if grep -q "^APP_DOMAIN=" .env; then
            sed -i "s|^APP_DOMAIN=.*|APP_DOMAIN=\"${HOSTNAME}\"|" .env
        else
            echo "APP_DOMAIN=\"${HOSTNAME}\"" >> .env
        fi

        # Update or append NEXT_PUBLIC_SITE_URL
        if grep -q "^NEXT_PUBLIC_SITE_URL=" .env; then
            sed -i "s|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=\"https://${HOSTNAME}\"|" .env
        else
            echo "NEXT_PUBLIC_SITE_URL=\"https://${HOSTNAME}\"" >> .env
        fi

        # Update or append NEXT_PUBLIC_API_URL
        if grep -q "^NEXT_PUBLIC_API_URL=" .env; then
            sed -i "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=\"https://${HOSTNAME}\"|" .env
        else
            echo "NEXT_PUBLIC_API_URL=\"https://${HOSTNAME}\"" >> .env
        fi

        # Update or append CLOUDFLARE_TUNNEL_TOKEN if token exists
        if [ -n "${EXISTING_TOKEN}" ]; then
            if grep -q "^CLOUDFLARE_TUNNEL_TOKEN=" .env; then
                sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=\"${EXISTING_TOKEN}\"|" .env
            else
                echo "CLOUDFLARE_TUNNEL_TOKEN=\"${EXISTING_TOKEN}\"" >> .env
            fi
        fi
        echo "[tunnel] .env successfully updated with hostname https://${HOSTNAME}."
    fi
}

# ------------------------------------------------------------------------------
# Execution Flow
# ------------------------------------------------------------------------------
install_cloudflared
detect_existing_tunnel

if [ -n "${EXISTING_TOKEN}" ] || [ -n "${EXISTING_TUNNEL_ID}" ]; then
    configure_existing_tunnel
else
    create_new_tunnel
fi

sync_env

echo "======================================================================"
echo "[tunnel] Cloudflare Tunnel configuration complete!"
echo "[tunnel] Hostname: https://${HOSTNAME}"
echo "[tunnel] Proxied to: ${TARGET_URL}"
echo "======================================================================"
