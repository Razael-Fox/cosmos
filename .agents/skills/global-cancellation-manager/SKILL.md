---
name: global-cancellation-manager
description: >
    Panduan baku untuk mengintegrasikan alur interaktif bertingkat (multi-step flows), konfirmasi transaksi, atau lobby game ke dalam sistem pembatalan global (.cancel) menggunakan src/utils/cancellationManager.ts.
---

# Global Cancellation Manager Standard (`.cancel`)

## 1. Konteks & Ringkasan

Dalam WhatsApp bot framework Cosmos, berbagai perintah membutuhkan interaksi lanjutan sebelum dieksekusi, seperti:

- Alur percakapan bertingkat (_multi-step wizard/dialog_), misalnya registrasi Virtual ID Card (`.ktp register`).
- Lobby game yang menunggu pemain lain atau host, misalnya Buckshot Roulette (`.creategame`).
- Dialog konfirmasi aksi berisiko tinggi (misalnya konfirmasi penjualan properti atau transfer dana).

Untuk memberikan pengalaman pengguna yang seragam dan mencegah pengguna terjebak di tengah alur, **seluruh fitur bertingkat atau konfirmasi WAJIB diintegrasikan ke dalam Sistem Pembatalan Global** (`src/utils/cancellationManager.ts`).

Dengan integrasi ini, pengguna dapat mengetikkan `.cancel`, `cancel`, `.batal`, `batal`, `.abort`, atau `abort` kapan saja untuk membatalkan operasi yang sedang berlangsung dengan aman.

---

## 2. Arsitektur & Modul Utama

1. **Manager Utility (`src/utils/cancellationManager.ts`)**:
    - Menyimpan registry sesi aktif dalam memori dengan isolasi ketat berdasarkan user (`userJid`) dan obrolan (`chatJid`).
    - Menyediakan API registrasi, pencarian, dan penanganan pembatalan.

2. **Dedicated Tool (`src/tools/cancel.ts`)**:
    - Menangani command `.cancel` (alias: `batal`, `abort`).
    - Jika ada sesi aktif untuk pengguna di chat tersebut, menjalankan callback pembatalan (`onCancel`).
    - Jika tidak ada sesi aktif, mengembalikan pesan informatif:
        > _"You do not have any active operation or pending confirmation to cancel in this chat."_

3. **Message Router Interceptor (`src/handlers/message.ts`)**:
    - Mendeteksi kata kunci pembatalan (`.cancel`, `cancel`, `.batal`, `batal`, `.abort`, `abort`) sebelum teks pesan diinterpretasikan sebagai langkah input percakapan biasa.

---

## 3. Cara Mengintegrasikan Fitur Baru

### Langkah 1: Daftarkan Sesi Saat Operasi Dimulai

Saat perintah memulai alur interaktif, panggil `registerCancellableSession`:

```typescript
import { registerCancellableSession } from '#/utils/cancellationManager.js';
import { cleanId } from '#/utils/casino.js';

// Di dalam eksekusi tool atau inisialisasi alur
registerCancellableSession({
    sessionId: `feature_${cleanId(userJid)}`,
    feature: 'feature_name',
    userJid: cleanId(userJid),
    chatJid: remoteJid,
    description: 'Deskripsi operasi dalam bahasa Inggris formal',
    onCancel: async (sock, msg) => {
        // 1. Bersihkan timeout / timer jika ada
        if (session.timeoutId) clearTimeout(session.timeoutId);

        // 2. Kembalikan saldo/taruhan jika ada yang ditahan
        // await refundUserBalance(...);

        // 3. Hapus state sesi lokal fitur
        localSessions.delete(cleanId(userJid));

        // 4. Kembalikan pesan konfirmasi pembatalan (Formal English)
        return 'The operation has been successfully cancelled.';
    }
});
```

### Langkah 2: Bersihkan Sesi Saat Operasi Selesai Berhasil

Setelah alur selesai (misalnya data berhasil disimpan atau game dimulai), hapus sesi dari cancellation manager:

```typescript
import { unregisterCancellableSessionByUser } from '#/utils/cancellationManager.js';

// Saat alur selesai dengan sukses:
unregisterCancellableSessionByUser(cleanId(userJid), remoteJid);
```

Atau jika menggunakan `sessionId`:

```typescript
import { unregisterCancellableSession } from '#/utils/cancellationManager.js';

unregisterCancellableSession(`roulette_${sessionId}`);
```

---

## 4. Pola Implementasi Sesuai Kasus Nyata

### Kasus A: Multi-step Conversational Form (contoh: KTP / Virtual ID)

- **Saat mulai:** Buat sesi lokal, lalu daftarkan ke `registerCancellableSession`.
- **Di callback `onCancel`:** Hapus sesi registrasi lokal dan kembalikan string:
  `"Virtual ID card registration has been cancelled."`
- **Saat step terakhir tereksekusi:** Panggil `unregisterCancellableSessionByUser` agar sesi tidak lagi dianggap aktif.

### Kasus B: Lobby Game / Sesi Bertimer (contoh: Roulette)

- **Saat lobby dibuat:** Daftarkan ke `registerCancellableSession`.
- **Di callback `onCancel`:** Hentikan `clearTimeout(session.timeoutId)`, kembalikan saldo seluruh pemain yang sudah menaruh taruhan ke database, hapus dari `gameSessions`, dan kembalikan pesan pembatalan.
- **Saat game dimulai / waktu habis:** Panggil `unregisterCancellableSession` agar host tidak membatalkan game yang sudah berjalan.

### Kasus C: Inisialisasi Resource Asinkron In-Flight (contoh: Sub-Bot Pairing Socket)

- **Saat proses dimulai:** Daftarkan ke `registerCancellableSession` dan teruskan callback `isAborted: () => !pendingPairings.has(key)` ke pembuat koneksi asinkron.
- **Pencegahan Zombie Resource:** Operasi asinkron (seperti Baileys `makeWASocket` atau unduhan besar) yang memakan waktu beberapa detik berpotensi selesai **setelah** pengguna mengetik `.cancel`. Dengan memeriksa `isAborted()`, soket yang baru saja tercipta langsung dimatikan (`sock.end()`) sehingga tidak meninggalkan koneksi background yang menggantung (_dangling socket_).
- **Di callback `onCancel`:** Hentikan timer timeout, matikan soket dari referensi sementara maupun map koneksi aktif, dan hapus sesi dari registry.

---

## 5. Yang Wajib & Yang Dilarang (Do's & Don'ts)

- ✅ **WAJIB:** Gunakan bahasa Inggris formal (_Formal English_) untuk seluruh string balasan pembatalan.
- ✅ **WAJIB:** Bersihkan semua side-effect (seperti timeout `setTimeout`, saldo yang di-lock, atau in-memory map) di dalam handler `onCancel`.
- ✅ **WAJIB:** Sediakan proteksi pembatalan in-flight (`isAborted`) pada operasi asinkron berat agar tidak meninggalkan koneksi/proses liar di background.
- ✅ **WAJIB:** Isolasi sesi berdasarkan pasangan `userJid` dan `chatJid` agar pembatalan pengguna di grup A tidak memengaruhi sesi miliknya di chat pribadi (DM) atau sesi pengguna lain di grup yang sama.
- ❌ **DILARANG:** Membuat keyword cancel tersendiri secara hardcoded (seperti hanya memeriksa `msg === 'batal'` di dalam tool lokal tanpa mendaftarkannya ke `cancellationManager`).
- ❌ **DILARANG:** Memanggil `sock.sendMessage` ganda jika `onCancel` sudah mengembalikan string (string yang dikembalikan akan otomatis dikirim oleh tool executor atau message router).
