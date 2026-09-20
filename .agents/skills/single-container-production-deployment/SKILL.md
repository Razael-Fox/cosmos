---
name: single-container-production-deployment
description: >
    Panduan baku arsitektur dan containerization multi-stage single-container Cosmos (Bot Engine + Fastify API Gateway + Next.js Webapp + Nginx + Cloudflare Tunnel) menggunakan PM2, Nginx reverse proxy non-root, loopback routing, dan handling hak akses volume SQLite.
---

# Cosmos Single-Container Production Deployment Standards

Dokumen ini adalah standar operasional dan panduan arsitektur containerization untuk repositori Cosmos dalam memaketkan tiga aplikasi independen (Bot WhatsApp, Fastify API Gateway, dan Next.js Web Portal) ke dalam satu kontainer Docker produksi (`cosmos-origin`) yang disupervisi oleh PM2 dan Nginx.

---

## 1. Arsitektur Multi-Service Single-Container

Cosmos dirancang untuk berjalan secara efisien pada satu VPS (bahkan di belakang NAT tanpa port publik) menggunakan ingress **Cloudflare Tunnel** outbound.

```
[ Internet ]
      │ (HTTPS / WSS via Cloudflare Edge)
      ▼
[ Cloudflare Tunnel Client (cloudflared) ]
      │ (Outbound QUIC Loopback -> http://127.0.0.1:80)
      ▼
[ Nginx Reverse Proxy (port 80) ]
      ├── /api/  ──► [ Fastify API Gateway (port 4000) ]
      ├── /ws/   ──► [ Fastify WebSocket (port 4000) ]
      └── /      ──► [ Next.js Web Portal Standalone (port 3000) ]
                            │
              [ IPC Unix Domain Socket (/app/storage/ipc.sock) ]
                            │
                            ▼
              [ WhatsApp Bot Engine (src/index.ts) ]
```

---

## 2. Aturan & Pola Baku (Core Guidelines)

### A. Docker Multi-Stage Build & Package Import Method

1. **Multi-Stage Builders:**
   Dockerfile menggunakan stage builder terpisah:
    - `builder-bot`: Mengompilasi TypeScript bot engine (`src/`) dan prisma client.
    - `builder-api`: Mengompilasi Fastify API Gateway dari `.worktrees/api/`.
    - `builder-web`: Mengompilasi Next.js frontend standalone dari `.worktrees/website/`.
2. **PNPM Copy Import Method:**
   Karena Docker multi-stage melintasi batasan layer filesystem, selalu jalankan `pnpm config set package-import-method copy` sebelum `pnpm install --frozen-lockfile` agar symlink pnpm tidak putus saat folder `node_modules` disalin ke stage runner.

```dockerfile
RUN pnpm config set package-import-method copy && \
    pnpm install --frozen-lockfile && \
    pnpm exec prisma generate && \
    pnpm build
```

---

### B. Non-Root Security & Nginx Configuration

1. **User Non-Root (`cosmos:1001`):**
   Kontainer produksi dijalankan di bawah pengguna unprivileged `cosmos` (UID 1001, GID 1001).
2. **Path Nginx Unprivileged:**
   Nginx standar berusaha menulis buffer sementara ke `/var/lib/nginx/*` yang memerlukan akses root. Pada non-root runner, Nginx WAJIB dikonfigurasi menggunakan `/tmp`:
    ```nginx
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path       /tmp/proxy_temp_path;
    fastcgi_temp_path     /tmp/fastcgi_temp;
    uwsgi_temp_path       /tmp/uwsgi_temp;
    scgi_temp_path        /tmp/scgi_temp;
    ```
3. **Direktori Nginx Perms:**
   Di dalam Dockerfile, direktori `/var/lib/nginx` dan `/var/log/nginx` wajib diinisialisasi dan diubah kepemilikannya ke `cosmos:cosmos`:
    ```dockerfile
    RUN mkdir -p /var/lib/nginx /var/log/nginx && chown -R cosmos:cosmos /var/lib/nginx /var/log/nginx
    ```
4. **Hapus Direktif `user`:**
   Pada file `docker/nginx.conf`, direktif `user cosmos;` di level root WAJIB dihapus karena Nginx yang dimulai oleh user non-root akan gagal jika mendeteksi direktif penggantian user.

---

### C. Next.js Standalone Hostname Binding

Next.js dalam mode `output: "standalone"` membaca variabel lingkungan `HOSTNAME`. Secara default di dalam kontainer Docker, `$HOSTNAME` diisi dengan container ID acak (misal `abbfa89eea4a`), yang menyebabkan server HTTP hanya mengikat ke IP kontainer tersebut dan menolak koneksi loopback dari `127.0.0.1:3000` Nginx.

**Solusi Wajib:**
Pada deklarasi `cosmos-web` di `docker/ecosystem.config.cjs`, tetapkan `HOSTNAME: '0.0.0.0'`:

```javascript
{
    name: 'cosmos-web',
    cwd: '/app/website',
    script: 'server.js',
    node_args: '--max-old-space-size=192',
    env: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0'
    },
    max_memory_restart: '220M',
    restart_delay: 3000
}
```

---

### D. Cloudflare Turnstile Build-Time vs Runtime

1. **Frontend `NEXT_PUBLIC_*` Build-Time Argument:**
   Variabel `NEXT_PUBLIC_TURNSTILE_SITE_KEY` disematkan ke dalam bundle JavaScript Next.js **pada saat build time**.
   Maka Dockerfile stage `builder-web` WAJIB mendeklarasikan:
    ```dockerfile
    ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY="1x00000000000000000000AA"
    ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
    ```
    Dan `docker-compose.yml` meneruskannya via `build.args`.
2. **Backend Secret Key Runtime Injection:**
   Variabel `CLOUDFLARE_TURNSTILE_SECRET_KEY` divalidasi oleh Fastify API Gateway **pada saat runtime** melalui `.env`.
3. **CSP Nginx:**
   Pada `docker/nginx.conf`, header `Content-Security-Policy` WAJIB mengizinkan `https://challenges.cloudflare.com` pada `script-src` dan `frame-src`.

---

### E. Penanganan Hak Akses Volume SQLite Host

Saat folder `./storage` dari host di-mount ke kontainer (`- ./storage:/app/storage`):

1. Pengguna di host (misalnya `admin` UID 1000) berbeda dari pengguna kontainer (`cosmos` UID 1001).
2. SQLite dalam mode WAL membutuhkan izin membuat file sementara `.sqlite-wal` dan `.sqlite-shm`.
3. Pastikan direktori `./storage` dan file database memiliki permission yang memadai (`chmod -R 777 ./storage` atau kepemilikan GID bersama) agar proses kontainer tidak mengalami crash `mkdir: Permission denied` atau `SQLITE_CANTOPEN`.
