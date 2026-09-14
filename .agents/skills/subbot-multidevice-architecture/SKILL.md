---
name: subbot-multidevice-architecture
description: >
    Panduan baku arsitektur dan implementasi Subsistem Sub-Bot Multi-Device (Jadibot) Cosmos, mencakup isolasi database SQLite per sesi, programmatic DDL bootstrapping, proteksi lifecycle/logout Baileys, pencegahan race condition pairing dengan global cancellation, resolusi kunci API bertingkat, dan anti-recursion guard.
---

# Cosmos Sub-Bot Multi-Device Architecture (Jadibot) Standards

Dokumen ini adalah panduan teknis dan standar baku untuk implementasi dan pemeliharaan arsitektur multi-perangkat (Sub-Bot / Jadibot System) pada Cosmos WhatsApp Bot Framework.

---

## 1. Ringkasan Arsitektur

Cosmos mendukung arsitektur multi-sesi otonom di mana pengguna dapat menautkan nomor WhatsApp pribadi mereka sebagai instans sub-bot independen (`.subbot pair <phone> <code|qr>`). Setiap sub-bot beroperasi mandiri dengan basis data, konfigurasi fitur, kredensial Baileys, dan integrasi kunci API terisolasi.

### Komponen Utama

- `src/services/subBotService.ts`: Mengelola siklus hidup koneksi Baileys sub-bot (`start`, `stop`, `delete`, `status`, `list`, `initSubBots`, `broadcastSubBotForex`).
- `src/services/subBotConfigService.ts`: Mengelola persistensi `database/{phoneNumber}/config.json` dengan _in-memory caching_.
- `src/utils/apiKeyResolver.ts`: Menyelesaikan kunci API AI secara bertingkat (`Sub-Bot Custom Key -> Parent Bot Fallback`).
- `src/tools/subbot.ts` & `src/tools/config.ts`: Antarmuka perintah pengguna (`.subbot` dan `.config`).
- `src/db.ts`: Inisialisasi basis data SQLite per sesi (`database/{phoneNumber}/database.sqlite`) dan bootstrapping skema DDL.
- `src/utils/connectionManager.ts`: Abstraksi koneksi Baileys multi-sesi dengan proteksi diskoneksi terisolasi.

---

## 2. Aturan & Pola Baku (Core Guidelines)

### A. Isolasi Database Per-Sesi & Schema DDL Bootstrapping

1. **Path Terisolasi:** Setiap sub-bot menggunakan path direktori khusus:
    - Direktori Sesi: `database/{phoneNumber}/`
    - Basis Data: `database/{phoneNumber}/database.sqlite`
    - Konfigurasi: `database/{phoneNumber}/config.json`
2. **Keterbatasan Lingkungan (Android Termux / PRoot):**
   Prisma engine (`schema-engine-debian-openssl`) tidak dapat di-spawn pada lingkungan sandbox Android Termux. Oleh karena itu, migrasi tidak boleh bergantung pada perintah CLI `prisma db push` atau `prisma migrate`.
3. **Programmatic DDL Bootstrapping:**
   Gunakan fungsi `ensureDatabaseSchema(dbPath)` di `src/db.ts` yang menjalankan `CREATE TABLE IF NOT EXISTS` dan `CREATE UNIQUE INDEX IF NOT EXISTS` menggunakan driver native `better-sqlite3` untuk seluruh 23 model tabel Prisma.
4. **Pembersihan Koneksi (Cleanup):**
   Saat sub-bot dihentikan (`stopSubBot`) atau dihapus (`deleteSubBot`), koneksi Prisma client wajib diputus via `disconnectPrismaClient(sessionId)` untuk melepaskan file lock SQLite.

```typescript
// ✅ Inisialisasi client Prisma terisolasi
const client = getPrismaClient(`sub_${phoneNumber}`);
await dbContext.run({ sessionId: `sub_${phoneNumber}`, prisma: client }, async () => {
    await handleMessage(sock, msg);
});
```

---

### B. Proteksi Lifecycle Baileys & Penanganan Logout

1. **Isolasi `process.exit(1)`:**
   Pada Baileys event `connection.update`, pemanggilan `process.exit(1)` saat terjadi diskoneksi permanen (`isLoggedOut === true` atau koneksi terputus tak terpulihkan) **HANYA BOLEH DILAKUKAN UNTUK SESI UTAMA (`sessionId === 'default'`)**.
2. **Sub-Bot Non-Fatal Handling:**
   Jika sesi sub-bot terputus atau logout:
    - Catat log peringatan.
    - Panggil `onClosed(isLoggedOut)`.
    - Hapus soket dari `activeConnections`.
    - Hapus waktu aktif dari `subBotStartTimes`.
    - Putuskan Prisma client via `disconnectPrismaClient(sessionId)`.
    - **DILARANG KERAS** mematikan proses utama Node.js!

```typescript
// ✅ Implementasi proteksi di connectionManager.ts
if (isLoggedOut) {
    if (sessionId === 'default') {
        console.error(`[${sessionId}] Logged out. Exiting process...`);
        process.exit(1);
    } else {
        console.warn(`[${sessionId}] Sub-bot logged out. Cleaning up session.`);
        activeConnections.delete(sessionId);
        onClosed?.(true);
    }
}
```

---

### C. Penanganan Race Condition Pairing & Pembatalan Global (.cancel)

1. **Sifat Asinkron Pembuatan Socket Baileys:**
   Pemanggilan `connectToWhatsApp` membutuhkan waktu (menunggu pembacaan kredensial auth dan `fetchLatestBaileysVersion`). Pengguna dapat mengirim `.cancel` sebelum socket selesai dibuat.
2. **Callback `isAborted`:**
   `ConnectOptions` wajib menerima callback `isAborted?: () => boolean`.
    - Periksa `isAborted()` sebelum instansiasi `makeWASocket`.
    - Periksa `isAborted()` segera setelah `makeWASocket` dibuat; jika `true`, segera panggil `sock.end(undefined)`.
3. **Pembersihan Komprehensif di `abortPairing`:**
   Saat dibatalkan via `.cancel`, fungsi `abortPairing`:
    - Menghentikan timeout timer (`clearTimeout`).
    - Mematikan socket dari `session.tempSock` maupun `activeConnections.get('sub_' + clean)`.
    - Menghapus sesi dari `pendingPairings` dan `unregisterCancellableSession`.

```typescript
// ✅ Contoh penanganan pembatalan aman di subBotService.ts
connectToWhatsApp({
    sessionId: `sub_${cleanNumber}`,
    phoneNumber: cleanNumber,
    pairingMethod: method,
    isAborted: () => !pendingPairings.has(cleanNumber),
    ...
});
```

---

### D. Resolusi Kunci API Bertingkat (Hierarchical API Key Resolution)

1. **Urutan Resolusi:**
    ```
    Sub-Bot config.json (apiKeys[service]) -> Parent Bot process.env -> null
    ```
2. **Masking Kredensial:**
   Saat menampilkan status kunci API pada kartu CGDS atau respon perintah:
    - Gunakan `maskApiKey(key)` dari `src/utils/apiKeyResolver.ts` (menghasilkan format `gsk_••••••••9aB2`).
    - Dilarang menampilkan kunci API secara mentah (plain text) ke pengguna.
3. **Peringatan Keamanan Obrolan Grup:**
   Jika pengguna mengonfigurasi kunci API di dalam grup WhatsApp publik (`chatJid.endsWith('@g.us')`), bot **WAJIB** menyertakan peringatan keamanan untuk menghapus pesan dan menyarankan konfigurasi via pesan pribadi (DM).
4. **Client Caching Berbasis Fingerprint:**
   Gunakan helper `getGroqClient(targetNumber)` yang meng-cache instance `Groq` berdasarkan hash/fingerprint kunci API agar tidak membuat instansiasi berulang pada setiap panggilan AI.

---

### E. Anti-Recursion Guard (Pencegahan Sub-Bot Bersarang)

Sub-bot dilarang keras menautkan atau membuat sub-bot lain (_infinite nesting_):

- Pada handler perintah `.subbot pair`, periksa session aktif dari `dbContext.getStore()`.
- Jika `currentSessionId !== 'default'`, tolak permintaan secara eksplisit dengan kartu alert penolakan (`tools.subbot.anti_recursion_title` / `tools.subbot.anti_recursion_desc`).

---

### F. Hierarki Resolusi Bahasa Pesan (4-Tier Language Resolution)

Pada level penanganan pesan (`src/handlers/message.ts`), bahasa obrolan diselesaikan dengan hierarki 4 tingkat:

```
1. WhitelistedGroup.language (jika pesan di grup)
   ↓
2. User.language (jika terdaftar di database sesi aktif)
   ↓
3. SubBotConfig.defaultLanguage (jika pesan ditangani oleh sub-bot)
   ↓
4. 'id' (Default Fallback)
```

---

### G. Supresi Broadcast Ekonomi (FOREX)

Saat parent bot mendistribusikan pengumuman harian FOREX dan pembaruan makroekonomi (`broadcastDailyForex` di `src/services/broadcast.ts`):

- Panggil `broadcastSubBotForex(multiplier, reasoning, rate)`.
- Loop setiap sub-bot yang aktif di `activeConnections`.
- Periksa konfigurasi sub-bot: `isFeatureEnabled(number, 'forexAnnouncement')`.
- Jika dinonaktifkan (`false`), lewati pengiriman pesan untuk sub-bot tersebut.

---

### H. Startup Staggered Reconnection

Saat Cosmos dimulai (`src/index.ts`), inisialisasi sub-bot yang tersimpan (`initSubBots()`):

- Baca seluruh direktori di folder `database/`.
- Periksa keberadaan kredensial yang valid.
- Hubungkan setiap sub-bot secara bertahap menggunakan jeda waktu (`await new Promise((r) => setTimeout(r, 3000))`) untuk mencegah lonjakan CPU, memori, dan koneksi jaringan simultan ke server WhatsApp.
