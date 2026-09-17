---
name: web-bot-ipc-bridge
description: Pola menjembatani API website ke bot engine via socket IPC Unix agar kredensial/aksi real (contoh: pairing sub-bot) menggantikan stub/mock.
---

# Bridge Web/API → Bot Engine via IPC Socket

Prinsip: proses API tidak boleh memfabrikasi kredensial yang hanya bisa diterbitkan oleh Baileys (pairing code, QR). Setiap aksi yang butuh socket hidup wajib diteruskan ke bot via socket IPC Unix (`BOT_IPC_SOCKET`, default `/app/storage/ipc.sock`, chmod 600, secret `INTERNAL_IPC_SECRET`).

## Kontrak 3 Sisi

1. **Bot** (`src/services/ipcServer.ts`): tambah `case '/internal/<domain>/<action>'` yang memanggil service real dan mengembalikan data real. Operasi headless (tanpa konteks perintah WhatsApp) ditaruh sebagai fungsi `...Headless` di service terkait (contoh: `requestPairingHeadless`), lengkap dengan guard validasi/kuota, timeout anti-bocor, dan notifikasi WhatsApp best-effort ke peminta.
2. **API** (`src/services/ipcClient.ts` + route): tambah fungsi `...ViaIpc`, panggil dari route. **Ukur timeout per operasi**: default 4 detik cukup untuk ping/kirim pesan, tetapi penerbitan kode pairing butuh hingga 90 detik (connect + version fetch) — parameter `timeoutMs` wajib disesuaikan.
3. **Status live**: untuk operasi berdurasi (pairing), sediakan endpoint status (`ACTIVE`/`PAIRING`/`IDLE`) dan relay via WebSocket dengan deadline sedikit di atas TTL (contoh: 135 detik vs 120 detik).

## Larangan Kredensial Fabrikasi

- DILARANG mengembalikan `crypto.randomBytes` sebagai pairing code/QR, atau fallback mock (`'COSMOS-88'`, SVG palsu) di route produksi maupun komponen web. Saat bot offline: kembalikan `503 BOT_OFFLINE`.
- Test yang mengasumsikan stub harus ditulis ulang untuk mengasert perilaku jujur (503 tanpa bot, guard 403 tetap berlaku, tidak ada baris phantom).
- Pembersihan state milik pembuatnya: baris `PAIRING` yang dibuat API wajib dihapus API saat sesi berakhir (deadline/IDLE), bukan dibiarkan menggantung.

## Deteksi Status Link yang Benar

`activeConnections.has(sessionId)` hanya berarti socket ada — socket mode-pairing terdaftar **sebelum** perangkat mengotorisasi. Status `ACTIVE`/`linked` wajib memeriksa `sock.authState.creds.registered === true` (contoh: `isSubBotLinked()`), bukan sekadar keberadaan socket. Jika tidak, dashboard akan menampilkan "paired" palsu dan kuota terkuras.
