# syntax=docker/dockerfile:1.4
# Cosmos all-in-one single-container image (Bot + API + Web + Nginx + cloudflared).
# Branches `website` and `api` are mounted via build contexts / worktrees; when absent
# only the bot engine stage is packaged and the remaining services no-op gracefully.

ARG NODE_VERSION=22-bookworm-slim

# -------------------------------------------------------------
# Stage 1: Build Bot Engine (main branch)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-bot
RUN corepack enable
WORKDIR /build/bot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && pnpm build

# -------------------------------------------------------------
# Stage 2: Build Web Portal (website branch, optional)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-website
WORKDIR /build/website
COPY .worktrees/website/package.json ./package.json
RUN echo "website context is optional; skipping when worktree is absent" && ls -la || true

# -------------------------------------------------------------
# Stage 3: Build API Gateway (api branch, optional)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-api
WORKDIR /build/api
COPY .worktrees/api/package.json ./package.json
RUN echo "api context is optional; skipping when worktree is absent" && ls -la || true

# -------------------------------------------------------------
# Stage 4: Hardened Production Runner (Non-Root User: cosmos)
# -------------------------------------------------------------
FROM node:${NODE_VERSION}
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nginx openssl curl ca-certificates libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

# Install cloudflared (multi-arch: amd64 / arm64)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then CF_ARCH="amd64"; else CF_ARCH="arm64"; fi && \
    curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" && \
    chmod +x /usr/local/bin/cloudflared

RUN npm install -g pm2
RUN groupadd -r cosmos -g 1001 && useradd -r -m -u 1001 -g cosmos cosmos
RUN setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx || true

WORKDIR /app
RUN mkdir -p /app/bot /app/storage /app/config /app/storage/logs /app/storage/auth_info_baileys && \
    chown -R cosmos:cosmos /app && chmod 700 /app/storage

COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/dist ./bot/dist
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/package.json ./bot/package.json
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/node_modules ./bot/node_modules
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/prisma ./bot/prisma
COPY docker/nginx.conf /app/config/nginx.conf
COPY docker/ecosystem.config.cjs /app/config/ecosystem.config.cjs
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown cosmos:cosmos /app/config/* /app/entrypoint.sh

USER cosmos
EXPOSE 80
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["pm2-runtime", "/app/config/ecosystem.config.cjs"]
