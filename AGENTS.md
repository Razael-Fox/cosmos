# AGENTS.md - Panduan & Peraturan untuk AI Coding Agent

Dokumen ini berisi panduan, instruksi, serta peraturan baku untuk AI Coding Agent yang bekerja pada repositori **Cosmos** (WhatsApp Bot Framework). Semua AI Agent wajib membaca dan mematuhi dokumen ini sebelum melakukan perubahan kode atau menjalankan tugas.

---

## 1. Ringkasan Proyek

- **Nama Proyek:** Cosmos (WhatsApp Bot Framework)
- **Package Manager:** **PNPM** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). **DILARANG** menggunakan `npm` atau `yarn` untuk menginstall dependency atau menjalankan script!
- **Bahasa Utama:** TypeScript (ESNext / Node.js ES Modules, `tsconfig.json`)
- **Library Utama:**
    - `@whiskeysockets/baileys` (Koneksi & Handler WhatsApp Web API)
    - `groq-sdk` (AI Speech-to-Text & LLM Function Calling)
    - `@prisma/client` (SQLite Database ORM Backend)
    - `sharp` & `@img/sharp-wasm32` (Pengolahan gambar / stiker)
    - `ffmpeg-static` (Pengolahan media audio/video/stiker bergerak)
    - `pino` (Logging system)

---

## 2. Struktur Proyek & Perintah Utama

### 📁 Struktur Direktori

- `src/` - Kode sumber utama TypeScript.
- `dist/` - Hasil kompilasi JavaScript (output dari `pnpm build`).
- `.agents/skills/` - Modul panduan & instruksi khusus untuk agent (misal: Baileys LID compatibility, FFmpeg buffer handling, Groq API rules, dll).
- `auth_info_baileys/` - Menyimpan kredensial sesi WhatsApp (Jangan di-commit / diubah secara manual).

### 🛠 Perintah Utama (PNPM Scripts)

| Perintah            | Fungsi                                                                     |
| :------------------ | :------------------------------------------------------------------------- |
| `pnpm dev`          | Menjalankan aplikasi dalam mode pengembangan (`tsx src/index.ts`)          |
| `pnpm build`        | Memproses kompilasi TypeScript (`tsc`) ke folder `dist/`                   |
| `pnpm typecheck`    | Memeriksa error tipe TypeScript tanpa menulis file output (`tsc --noEmit`) |
| `pnpm lint`         | Memeriksa kepatuhan kode dengan aturan ESLint                              |
| `pnpm format`       | Melakukan formatting otomatis menggunakan Prettier                         |
| `pnpm add <pkg>`    | Menambahkan paket dependency baru                                          |
| `pnpm add -D <pkg>` | Menambahkan paket devDependency baru                                       |
| `pnpm install`      | Menginstall seluruh dependency berdasarkan `pnpm-lock.yaml`                |

---

## 3. Peraturan Utama (Core Rules for AI Agent)

### A. Penggunaan PNPM & TypeScript

- **PNPM Exclusivity:** Proyek ini dikelola penuh dengan PNPM. Dilarang menjalankan perintah `npm install`, `npm run`, `yarn`, dll. Selalu gunakan `pnpm`.
- **TypeScript Strictness:** Semua file baru atau perubahan file wajib ditulis menggunakan TypeScript (`.ts`) yang valid sesuai dengan `tsconfig.json`. Pastikan tipe data eksplisit dan hindari penggunaan `any` tanpa alasan kuat.

### B. Verifikasi Mutlak Sebelum Mengklaim Selesai

- **DILARANG** mengklaim perbaikan atau fitur telah selesai tanpa menjalankan verifikasi empiris.
- Setelah mengedit kode, AI Agent wajib setidaknya menjalankan:
    1. `pnpm typecheck`
    2. `pnpm lint`
    3. `pnpm build` (jika diperlukan untuk memastikan kompilasi dist bersih)
    4. `pnpm format` (wajib dijalankan untuk merapikan kode sebelum di-commit)

### C. Logging & Debugging

- **Pterodactyl Console Visibility:** Pastikan setiap log penting dan pesan error dicetak ke `console.log` / `console.error` agar muncul di terminal panel Pterodactyl. Jangan hanya menyimpan log ke file JSON/TXT saja.
- **Investigasi Log Lengkap:** Jika terjadi runtime error, baca log lengkap (stack trace) sebelum mendiagnosis. Dilarang melakukan patch superfisial (seperti membungkus kode dengan `try/catch` kosong atau menutupi exception).

### D. Penanganan Media & FFmpeg

- **Buffer ke Temporary File:** Sebelum menjalankan perintah FFmpeg eksternal, pastikan media buffer telah ditulis terlebih dahulu ke temporary file di disk (misalnya menggunakan `fs.writeFileSync` ke path temp). Jangan melewatkan buffer mentah langsung jika library memerlukan file path.
- **Stiker Video / GIF:** Perhatikan batas ukuran, fps, dan format output WebP agar stiker dapat dirender dengan sempurna di WhatsApp.

### E. Integrasi Baileys (WhatsApp API)

- **Kompatibilitas JID vs LID:** Di Baileys v7+, identifikasi pengguna dapat berupa JID (`@s.whatsapp.net`) atau LID (`@lid`). Gunakan helper/logic pencocokan yang mendukung kedua format tersebut agar identifikasi pengguna tidak mismatch.
- **Mentions Hijau (Green Mentions):** Untuk memastikan JID/LID dapat di-mention dengan benar oleh WhatsApp dan merender nama pengguna (pushname), **WAJIB** menggunakan fungsi global `formatMentions` dari `src/utils/casino.ts` saat mengisi array `mentions`. Jangan menebak domain `@s.whatsapp.net` atau `@lid` secara manual karena dapat menyebabkan mention gagal dirender (plain-text).

### F. Integrasi Groq SDK & LLM

- **Native Function Calling:** Gunakan Native Function Calling dari Groq SDK. Jangan membuat tag XML manual (seperti `<function=...>` atau `<tool_call>`) di dalam teks prompt atau output.
- **Upload File Audio Groq:** Saat mengirimkan buffer binary ke API transkripsi Groq Whisper di Node.js, manfaatkan helper `toFile` dari `groq-sdk` agar pengiriman stream/buffer valid.

### G. Kepatuhan Kode & ESLint

- **No Unused Variables:** Hindari mendeklarasikan variabel, parameter, atau import yang tidak digunakan. Pastikan kode lolos periksa ESLint (`eslint-no-unused-vars-handling`).
- **Modul ES (ESM):** Proyek ini menggunakan `"type": "module"`. Pastikan sintaks import/export konsisten.

### H. Penggunaan Bahasa Inggris Formal untuk String Output

- **Formal English Output Strings:** Semua string bertipe output ke pengguna (pesan respon bot, deskripsi tool/command, pesan error, log sistem, dan prompt AI) WAJIB ditulis dalam Bahasa Inggris Formal (_Formal English_), bukan Bahasa Indonesia baku atau tidak baku (rujuk panduan di `.agents/skills/formal-english-output-strings/SKILL.md`).

### I. Manajemen Versi Lokal (Git Local Commits)

- **Wajib Commit Lokal:** Setiap kali menyelesaikan sebuah tugas atau perubahan kode, AI Agent **WAJIB** melakukan commit secara lokal (`git add .` dan `git commit -m "..."`) tanpa perlu melakukan `push`. Hal ini bertujuan agar diff kode selalu tercatat, konteks pekerjaan tidak hilang antar-sesi, dan meminimalisir risiko perubahan dari sesi sebelumnya tertinggal saat sesi berikutnya diinstruksikan untuk melakukan `push`.

---

## 4. Workflow Kerja AI Agent

1. **Pahami Kebutuhan:** Analisis permintaan pengguna dan periksa file terkait di `src/` atau panduan di `.agents/skills/`.
2. **Inspeksi Kode:** Selalu periksa file sumber asli sebelum mengubah logika atau nama fungsi/tipe.
3. **Eksekusi Perubahan:** Lakukan pengeditan kode secara presisi dan bersih dalam TypeScript.
4. **Jalankan Verifikasi:** Jalankan `pnpm typecheck` dan `pnpm lint` untuk memastikan tidak ada syntax error atau tipe mismatch.
5. **Format Kode:** Jalankan `pnpm format` agar format kode seragam dan sesuai standar (jalankan setelah script lainnya).
6. **Lakukan Git Commit:** Lakukan commit lokal atas semua perubahan yang telah selesai dan terverifikasi beserta hasil formatting.
7. **Ringkaskan Hasil:** Berikan penjelasan singkat, padat, dan jelas mengenai perubahan yang telah dilakukan beserta bukti verifikasi.

### J. Database & Persistensi (Prisma SQLite)

- **Local Persistence:** Cosmos menggunakan Prisma ORM dengan SQLite untuk menyimpan state, kredensial Baileys, konfigurasi auto-dl, dan antrean `ScheduledDeletion`.
- **Auto-Delete Queue:** Segala bentuk task _auto-delete_ untuk pesan harus diintegrasikan dengan database Prisma (tabel `ScheduledDeletion`) agar antrean tidak hilang saat server di-restart atau crash. Jangan menggunakan `setTimeout` in-memory.

### K. Pencegahan Eksekusi Pesan Ganda

- **Message Processing Cache:** WhatsApp Baileys sering mengirimkan event message secara berulang (misal: `notify` disusul `append` saat sync). WAJIB menggunakan metode `isMessageProcessed` dan `markMessageProcessed` (dari `messageCache.ts`) pada level tertinggi handler (`handleMessage`) untuk memfilter ID pesan agar tidak ada fitur, minigame, atau auto-response yang tereksekusi dua kali pada satu pesan yang sama.

### L. Format Mata Uang Rupiah (IDR Currency Standards)

- **Rupiah Formatting Convention:** Setiap kali menampilkan atau memproses nilai mata uang Rupiah (saldo, taruhan, reward, payout, harga), **WAJIB** menggunakan konvensi lokal Indonesia (`Rp` tepat di depan angka tanpa spasi, pemisah ribuan berupa titik `.`, dan tanpa desimal secara default, misal: `Rp10.000`, `Rp1.000.000`).
- **Global Currency Utility:** **WAJIB** menggunakan fungsi global `formatRupiah` dan `parseCurrencyAmount` dari `src/utils/currency.ts`. Dilarang memformat string mata uang manual secara terpecah-pecah atau menggunakan `parseInt` mentah yang merusak titik ribuan (rujuk panduan di `.agents/skills/rupiah-currency-formatting/SKILL.md`).

### M. Bot Prefix (Command Prefix)

- **Standard Prefix:** Cosmos menggunakan titik (`.`) sebagai prefix untuk setiap command bot. **DILARANG** menggunakan tanda seru (`!`), slash (`/`), atau karakter lain sebagai prefix saat menuliskan panduan, rencana, atau merespons pengguna mengenai fitur bot (misal: gunakan `.shop` alih-alih `!shop`).

### N. Pembatalan Global & Alur Interaktif (Global Cancellation System)

- **Global Cancellation Registry:** Seluruh fitur interaktif yang memiliki alur percakapan bertingkat (_multi-step conversational flow_), dialog konfirmasi aksi berisiko, atau sesi tunggu/lobby game (seperti Buckshot Roulette atau pendaftaran Virtual ID/KTP) **WAJIB** diintegrasikan ke dalam `src/utils/cancellationManager.ts` menggunakan fungsi `registerCancellableSession`.
- **Dukungan Command `.cancel`:** Pengguna harus selalu dapat membatalkan proses dengan mengetikkan `.cancel` (atau `cancel`, `.batal`, `batal`, `.abort`, `abort`). Handler pembatalan wajib membersihkan state, timeout/timer, atau mengembalikan saldo/taruhan jika ada, lalu membatalkan pendaftaran sesi (`unregisterCancellableSession` atau `unregisterCancellableSessionByUser`). Rujuk panduan lengkap di `.agents/skills/global-cancellation-manager/SKILL.md`.

### O. Sistem Internasionalisasi & Multibahasa (i18n Localization Standards)

- **i18n Integration:** Seluruh tool dan modul wajib mendukung sistem multibahasa dengan menggunakan `ctx.t` dan `ctx.lang` dari `src/locales/i18n.config.ts`. Dilarang menggabungkan string terjemahan dengan teks statis bahasa Inggris manual (_mixed-language_).
- **Safe Key Detection & Build Sync:** Deteksi kunci terjemahan WAJIB menggunakan `i18n.exists()`. File terjemahan JSON di `src/locales/` wajib disinkronkan ke `dist/locales/` saat proses build melalui `scripts/copy-locales.ts`. Rujuk panduan lengkap di `.agents/skills/i18n-localization-standards/SKILL.md`.

### P. Subsistem Perbankan Cosmos (Cosmos Central Bank Standards)

- **ACID Double-Entry Ledger:** Seluruh mutasi perbankan (`DEPOSIT`, `WITHDRAW`, `TRANSFER_IN`, `TRANSFER_OUT`, `INTEREST`, `REGISTRATION_FEE`) **WAJIB** dijalankan secara atomik melalui `prisma.$transaction` dengan merekam `balanceAfter` pada model `BankTransaction`.
- **KTP Gate & Konfirmasi Interaktif:** Pembuatan rekening bank wajib memverifikasi kepemilikan KTP (`isRegistered = true`). Transaksi transfer wajib menggunakan alur konfirmasi interaktif 3 menit yang terintegrasi dengan `cancellationManager` (`.cancel`) dan resolusi bahasa dinamis untuk penerima transfer. Rujuk panduan lengkap di `.agents/skills/cosmos-central-bank/SKILL.md`.

### Q. Subsistem Pinjaman Bank & Penilaian Risiko Kredit AI (Bank Loan System Standards)

- **Underwriting AI & Dynamic Tiers:** Penilaian pinjaman wajib melalui Groq LLM Native Function Calling dengan batasan terikat (suhu 0.1, bunga 2%–15%, tenor 7–30 hari) dan fallback deterministik. Skor kredit dibatasi secara ketat antara 0 hingga 1000 berdasarkan `ActivityLog` 30 hari terakhir.
- **Proteksi Mutlak Race Condition:** Setiap eksekusi pengajuan, pencairan dana, dan pelunasan pinjaman **WAJIB** dilindungi dengan mutex memori in-flight (`Set<string>`) dan validasi ulang status pinjaman/saldo langsung di dalam transaksi database `prisma.$transaction`.
- **Penyitaan Aset Otomatis & Pembekuan Rekening:** Gagal bayar pinjaman jatuh tempo wajib memicu pembekuan rekening bank (`status = 'FROZEN'`) dan likuidasi aset inventaris/properti terurut dari nilai tertinggi ke terendah (`ownershipStatus = 'Pawned'`) hingga hutang tertutupi. Rujuk panduan lengkap di `.agents/skills/bank-loan-system/SKILL.md`.

### R. Subsistem Pekerjaan & Gaji Dinamis (Job and Salary System Standards)

- **KTP Gate & Prasyarat Inventaris:** Seluruh akses pendaftaran pekerjaan (`.job join`) dan shift kerja (`.work`) **WAJIB** memverifikasi kepemilikan Virtual ID Card (`requireIdCard`) dan kepemilikan item peralatan aktif di inventaris (`UserInventory` dengan `ownershipStatus === 'Owned'`).
- **Skalabilitas Makroekonomi & Payout Atomik:** Pembayaran gaji wajib dikalikan dengan `EconomyMultiplier` terkini. Pembaruan saldo pengguna dan pelacakan cooldown shift (`lastWorkedAt`) wajib dieksekusi secara atomik menggunakan `prisma.$transaction` serta dicatat ke `ActivityLog`. Rujuk panduan lengkap di `.agents/skills/job-and-salary-system/SKILL.md`.

### S. Format Versi Rilis RF (RF-YYMM-BUILD Versioning Standards)

- **Skema Penomoran Versi:** Penomoran rilis dan versi Cosmos wajib menggunakan format `RF-YYMM-BUILD` (misal: `RF-2609-03`). Dilarang menggunakan semver biasa (`v1.2.0`) pada tag rilis atau changelog.
- **Otomasi Pre-Release:** Seluruh pembuatan tag rilis dan publikasi halaman release di GitHub didelegasikan melalui script otomasi `scripts/release.ts` (`pnpm run release:pre`).

### T. Standar Menu Bot & Kompatibilitas Deskripsi Perintah i18n (Menu & Command Description i18n Standards)

- **Kompatibilitas Deskripsi Perintah (i18n Command Description):** Setiap deklarasi `ToolDefinition` di `src/tools/` **WAJIB** menyertakan atribut `descriptionKey` (berformat `tools.commands.<clean_name>.description`) selain `description` default berbahasa Inggris untuk keperluan Groq LLM tool calling. Seluruh deskripsi perintah wajib didaftarkan secara simetris di `src/locales/en/tools.json` dan `src/locales/id/tools.json` pada objek `"commands"`.
- **Resolusi Deskripsi Dinamis:** Penampilan deskripsi perintah pada menu dan panduan bantuan (`.menu`, `.help`, `.menu <category>`, `.help <command>`) **WAJIB** diselesaikan secara dinamis melalui helper `resolveToolDescription(tool, t)` atau `menuService.getToolDescription(tool, t)` agar bahasa deskripsi dirender sesuai preferensi bahasa pengguna/obrolan (`ctx.t`).
- **Modern Hero Banner & Baileys ExternalAdReply:** Seluruh respon tampilan menu bot (`.menu`, `.help`) **WAJIB** dikirimkan via Baileys `externalAdReply` dengan atribut `renderLargerThumbnail: true`, memanfaatkan buffer thumbnail aman dari `getMenuBannerBuffer()` (otomatis fallback ke placeholder jika file kosong/rusak), serta mengembalikan `undefined` untuk mencegah echo duplikasi pesan pada pipeline handler.
