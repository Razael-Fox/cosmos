---
name: container-deploy-verification
description: Checklist verifikasi deploy kontainer single-container Cosmos: samakan image berjalan vs hasil build, kesehatan service, dan ruang disk.
---

# Verifikasi Deploy Kontainer Cosmos

Jangan pernah mengklaim perbaikan "sudah live" hanya karena `docker compose build` sukses. Build tanpa redeploy = pengguna menguji kode lama.

## 1. Samakan Image Berjalan vs Terbaru

```bash
docker inspect cosmos-all-in-one --format '{{.Image}}'
docker images --no-trunc cosmos-all-in-one:latest --format '{{.ID}}'
```

Beda ID → jalankan `docker compose up -d` (recreate) lalu verifikasi ulang.

## 2. Buktikan Fix Ada di Bundle Berjalan

```bash
# Bot/API (dist JS):
docker exec cosmos-all-in-one grep -c "<namaFungsiBaru>" /app/bot/dist/... /app/api/dist/...
# Website (bundle minified → cari string literal, bukan nama variabel):
docker exec cosmos-all-in-one grep -r -l "<string-literal-unik>" /app/website/.next/
# Kunci build-time (NEXT_PUBLIC_*):
docker exec cosmos-all-in-one grep -r -o "<nilai-key>" /app/website/.next/static | head
```

Catatan: `NEXT_PUBLIC_*` tertanam saat build. Perubahan `.env` untuk variabel tersebut (contoh: `BOT_PHONE_NUMBER` → `NEXT_PUBLIC_BOT_NUMBER`) **wajib** `build` ulang + `up -d`; restart saja tidak cukup. Variabel runtime (secret, token) cukup `up -d`.

## 3. Kesehatan Service & Sesi

```bash
docker exec cosmos-all-in-one /usr/local/bin/pm2 list   # semua online, cosmos-bot ↺ stabil
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/<route>
docker logs cosmos-all-in-one --tail 40 | grep -a -v -E "cloudflared|argotunnel"
```

Sesi WhatsApp tersimpan di volume `./storage` (bukan di image) — recreate aman tanpa pairing ulang. File `.env` berisi secret dan di-gitignore: jangan commit, jangan tampilkan nilainya.

## 4. Ruang Disk Sebelum Build

Multi-stage build + cache dapat menghabiskan >10GB. Sebelum build:

```bash
df -h /; docker system df
docker builder prune -f   # cache akan dibangun ulang → build berikutnya lambat
```

Kegagalan khas: `failed to extract layer ... no space left on device` di tengah build.
