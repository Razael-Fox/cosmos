# syntax=docker/dockerfile:1.4
# Cosmos origin single-container image (Bot + API + Web + Nginx + cloudflared).

ARG NODE_VERSION=22-bookworm-slim

# -------------------------------------------------------------
# Stage 1: Build Bot Engine (main branch)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-bot
RUN corepack enable
WORKDIR /build/bot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm config set package-import-method copy && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-maxtimeout 180000 && \
    pnpm install --frozen-lockfile && \
    pnpm exec prisma generate
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
RUN pnpm build

# -------------------------------------------------------------
# Stage 2: Build API Gateway (api branch)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-api
RUN corepack enable
WORKDIR /build/api
COPY .worktrees/api/package.json .worktrees/api/pnpm-lock.yaml .worktrees/api/pnpm-workspace.yaml .worktrees/api/tsconfig.json ./
COPY .worktrees/api/prisma ./prisma
COPY .worktrees/api/prisma.config.ts ./
RUN pnpm config set package-import-method copy && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-maxtimeout 180000 && \
    pnpm install --frozen-lockfile && \
    pnpm exec prisma generate
COPY .worktrees/api/src ./src
RUN pnpm build

# -------------------------------------------------------------
# Stage 3: Build Web Portal (website branch)
# -------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder-web
RUN corepack enable
WORKDIR /build/web
COPY .worktrees/website/package.json .worktrees/website/pnpm-lock.yaml .worktrees/website/pnpm-workspace.yaml .worktrees/website/tsconfig.json ./
COPY .worktrees/website/next.config.ts .worktrees/website/components.json .worktrees/website/postcss.config.mjs ./
RUN pnpm config set package-import-method copy && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-maxtimeout 180000 && \
    pnpm install --frozen-lockfile
COPY .worktrees/website/public ./public
COPY .worktrees/website/app ./app
COPY .worktrees/website/components ./components
COPY .worktrees/website/lib ./lib

ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY="1x00000000000000000000AA"
ARG NEXT_PUBLIC_SITE_URL="https://cosmos.razael-fox.my.id"
ARG NEXT_PUBLIC_API_URL="https://cosmos.razael-fox.my.id"
ARG NEXT_PUBLIC_BOT_NUMBER=""
ARG NEXT_PUBLIC_SALES_NUMBER=""

ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_BOT_NUMBER=$NEXT_PUBLIC_BOT_NUMBER \
    NEXT_PUBLIC_SALES_NUMBER=$NEXT_PUBLIC_SALES_NUMBER

RUN pnpm build

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
RUN mkdir -p /var/lib/nginx /var/log/nginx && chown -R cosmos:cosmos /var/lib/nginx /var/log/nginx

WORKDIR /app
RUN mkdir -p /app/bot /app/api /app/website /app/storage /app/config /app/storage/logs /app/storage/auth_info_baileys /app/storage/sub-bot && \
    chown -R cosmos:cosmos /app && chmod 777 /app/storage /app/storage/sub-bot

# Package Bot Engine
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/dist ./bot/dist
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/package.json ./bot/package.json
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/node_modules ./bot/node_modules
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/prisma ./bot/prisma
COPY --from=builder-bot --chown=cosmos:cosmos /build/bot/assets ./bot/assets

# Package API Gateway
COPY --from=builder-api --chown=cosmos:cosmos /build/api/dist ./api/dist
COPY --from=builder-api --chown=cosmos:cosmos /build/api/package.json ./api/package.json
COPY --from=builder-api --chown=cosmos:cosmos /build/api/node_modules ./api/node_modules
COPY --from=builder-api --chown=cosmos:cosmos /build/api/prisma ./api/prisma

# Package Web Portal (Next.js standalone)
COPY --from=builder-web --chown=cosmos:cosmos /build/web/.next/standalone ./website
COPY --from=builder-web --chown=cosmos:cosmos /build/web/.next/static ./website/.next/static
COPY --from=builder-web --chown=cosmos:cosmos /build/web/public ./website/public

COPY docker/nginx.conf /app/config/nginx.conf
COPY docker/ecosystem.config.cjs /app/config/ecosystem.config.cjs
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown cosmos:cosmos /app/config/* /app/entrypoint.sh

USER cosmos
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://127.0.0.1:80/healthz || curl -f http://127.0.0.1:80/ || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["pm2-runtime", "/app/config/ecosystem.config.cjs"]
