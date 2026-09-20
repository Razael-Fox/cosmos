---
name: turnstile-widget-loop-debugging
description: Panduan mendiagnosis dan memperbaiki widget Cloudflare Turnstile yang berputar (spinner) tanpa henti di halaman register website Cosmos.
---

# Debugging Infinite Spinner Widget Cloudflare Turnstile

Gejala: pengguna membuka halaman register, widget Turnstile terus loading/spinning, hilang-muncul berulang, dan tidak pernah menampilkan tanda centang.

## Lapisan 1: React Remount Loop (Bug Kode)

Efek `turnstile.render()` yang bergantung pada callback inline (`onVerify={(t) => setToken(t)}`) akan re-render pada setiap render parent → `remove()` + `render()` berulang → spinner abadi.

Aturan baku (`components/Turnstile.tsx`):

- Stabilkan callback parent dengan `useCallback`, teruskan via `ref` (`onVerifyRef`) agar dependensi efek tetap `[isScriptLoaded, siteKey, theme]`.
- Render tepat satu kali (`if (widgetIdRef.current) return`) dengan guard `isCancelled` dan cleanup `turnstile.remove()`.

## Lapisan 2: Cloudflare Auto-Retry Loop (Konfigurasi)

Untuk error persisten (sitekey salah, domain tidak allowlisted), Turnstile dengan `retry: 'auto'` (default) menghapus dan menyisipkan ulang iframe tantangan **tanpa henti**.

Aturan baku:

- Set `retry: 'never'` dan `refresh-expired: 'auto'` pada opsi `render`.
- Tampilkan error box + tombol manual `turnstile.reset()` (jangan diam saat `error-callback`/`timeout-callback`).
- Log kode error ke console (cek `600010` = hostname tidak terdaftar pada sitekey tersebut).
- Selalu teruskan `onError` dari halaman pemanggil dan kosongkan token basi (`setTurnstileToken(null)`).

## Lapisan 3: Build-Time Key & Stale Deploy (Operasional)

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` tertanam saat **build time**. Wajib rebuild dengan `--build-arg` (via `docker-compose.yml` dari `.env`), bukan sekadar restart.
- Domain pengunjung wajib ada di Cloudflare Dashboard → Turnstile → Allowed hostnames (termasuk `localhost` untuk dev).
- Setelah deploy, verifikasi bundle yang **berjalan** (bukan yang baru dibangun):
    ```bash
    docker inspect <container> --format '{{.Image}}'
    docker images --no-trunc cosmos-origin:latest --format '{{.ID}}'
    docker exec <container> grep -r -l "<string-perbaikan>" /app/website/.next/static
    ```
- Minta pengguna hard-refresh (`Ctrl+Shift+R`) agar chunk JS lama tidak ter-cache.
