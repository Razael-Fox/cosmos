---
name: baileys-pairing-operations
description: Prosedur operasional pairing Baileys (pairing code & QR): siklus hidup kode, disiplin satu percobaan, diagnosis handshake macet, dan cooldown rate-limit.
---

# Operasi Pairing Baileys (Pairing Code & QR)

## Siklus Hidup Kode Pairing

- Kode diminta via `sock.requestPairingCode(phone)` setelah WebSocket tersambung (ada jeda `fetchLatestBaileysVersion` + delay ~3 detik).
- TTL sesi pairing: **120 detik** (code) / **60 detik** (qr). Setelah itu `abortPairing` + socket ditutup (`QR refs attempts ended`, kode 408).
- Kode terikat pada nomor yang diminta. Kode untuk nomor A yang dimasukkan di HP nomor B **selalu gagal** (`Couldn't link device`).
- Tanda sukses di log: `pair success recv` → `pairing configured successfully` → `Closed 515 (restart required)` → `Opened` + history sync.

## Disiplin Satu Percobaan Terkoordinasi

Meminta banyak kode beruntun (teramati: ~7 kode/jam) menyebabkan:

1. Kebingungan kode basi — kode lama yang dimasukkan setelah sesi berganti akan **di-drop diam-diam oleh server** (bot sunyi, HP error generik). Selalu tutup modal lama, minta SATU kode baru, masukkan dalam **30 detik**.
2. **Rate-limit WhatsApp** — handshake berikutnya ikut macet total tanpa error di kedua sisi.

Prosedur baku: satu kode → masukkan cepat → konfirmasi waktu request + waktu entry → baca log. Jika gagal, **cooldown 1–2 jam** sebelum mencoba lagi (jangan spam request).

## Diagnosis Handshake Macet

- `Invalid buffer` di `processNotification` (`messages-recv.ts`, `toRequiredBuffer`): stanza `link_code_companion_reg` cacat/transien. Selama sesi masih hidup, ulangi entry; jika sesi mati, minta kode baru. Bukan alasan untuk patch library.
- Sunyi total setelah `link_code_companion_reg` (tidak ada error, tidak ada `pair success`): server me-drop `companion_finish` — hampir selalu kode basi/salah nomor. Jangan patch crypto; koordinasikan ulang percobaan.
- Untuk membuktikan, aktifkan sementara log anak stanza (`link_code_pairing_ref`, `primary_identity_pub`, `link_code_pairing_wrapped_primary_ephemeral_pub`) lalu hapus kembali (jangan commit debug hook).

## Catatan Akun & Perangkat

- Pastikan WhatsApp (termasuk varian Business) di HP target versi terbaru.
- Uji kontrol: tautkan **WhatsApp Web resmi** via QR. Jika itu pun gagal → masalah akun/perangkat, bukan Cosmos. Jika berhasil → lanjutkan diagnosis di sisi Baileys.
- Metode QR (`pair <number> qr`) memakai jalur handshake berbeda dan layak dicoba sekali setelah cooldown bila metode kode macet.
