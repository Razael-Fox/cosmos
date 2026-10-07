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
    - `sharp` (Pengolahan gambar / stiker)
    - `ffmpeg-static` (Pengolahan media audio/video/stiker bergerak)
    - `pino` (Logging system)

---

## 2. Struktur Proyek & Perintah Utama

### 📁 Struktur Direktori

- `src/` - Kode sumber utama TypeScript (bot engine):
    - `cli/` - CLI pairing (`pair.ts` WhatsApp, `tgpair.ts` Telegram).
    - `seeds/` - Seeder katalog (`items.ts`, `properties.ts`), dipanggil dari `src/index.ts`.
    - `handlers/` - Router pesan (`message.ts`).
    - `tools/` - Satu file per command. Command satu keluarga ditaruh di subfolder (`tools/group/`, `tools/property/`). `handler.ts` memuat tool secara **rekursif**, jadi subfolder baru otomatis terdeteksi; `handler.ts` dan `types.ts` tidak dimuat sebagai tool.
    - `services/` - Logika domain & infrastruktur (bank, loan, job, agentEngine, statusNotifier, IPC, broadcast).
    - `utils/` - Helper lintas-fitur (`utils/sticker/` untuk modul stiker, `utils/security/` untuk guard keamanan).
    - `mcp/` - Cosmos MCP server. Contoh konfigurasi klien ada di `docs/mcp/` (bukan di `src/mcp/`).
    - `locales/` - Terjemahan `en` dan `id` (5 namespace JSON per bahasa).
    - `generated/` - Output Prisma Client (gitignored; jangan diedit).
- `scripts/` - Dikelompokkan per tujuan: `admin/` (alat operator), `docker/` (build/deploy/dev), `i18n/` (copy-locales, validate, check-usage), `infra/` (Cloudflare tunnel, Turnstile, Doppler), `migrations/` (migrasi data sekali jalan), `release/` (`version.ts`, `release.ts`). Skrip shell menghitung `ROOT_DIR` dengan `/../..`; pertahankan itu bila memindahkan skrip.
- `assets/` - Aset statis yang ikut ke image Docker (banner menu, `ktp_template.jpg`, `fonts/`). Aset statis **dilarang** ditaruh di `storage/`.
- `storage/` - **Hanya** state runtime (database, sesi, log, backup, `ipc.sock`) yang di-mount sebagai volume.
- `database/` - Database SQLite per sub-bot (runtime, gitignored).
- `bin/` - Salinan lokal opsional `yt-dlp` (gitignored). Image Docker memasang yt-dlp sendiri; gunakan `pnpm docker:dev` untuk fitur downloader.
- `docker/` - Dockerfile, nginx, konfigurasi PM2 kontainer, entrypoint.
- `docs/` - Dokumentasi (`VERSIONING.md`, `COSMOS_MCP.md`, `COMMANDS_CONTEXT.md`, `mcp/`).
- `tests/` - Suite uji, nama file camelCase (`<subjek>.test.ts`); smoke test di `tests/smoke/`.
- `dist/` - Hasil kompilasi JavaScript (output dari `pnpm build`).
- `.agents/skills/` - Modul panduan & instruksi khusus untuk agent (misal: Baileys LID compatibility, FFmpeg buffer handling, Groq API rules, Cosmos versioning & tabrakan branch paralel, dll).
- `auth_info_baileys/` - Menyimpan kredensial sesi WhatsApp (Jangan di-commit / diubah secara manual).
- Menambah/memindah file: gunakan `git mv`, perbarui seluruh import (`#alias` maupun relatif) beserta referensi path di `package.json`, `README.md`, `AGENTS.md`, dan skill terkait, lalu jalankan `pnpm typecheck`, `pnpm lint`, dan `pnpm build`. File di `tests/` dan `scripts/` **tidak** tercakup `tsc`, jadi periksa import-nya dengan menjalankan suite uji.

### 🛠 Perintah Utama (PNPM Scripts)

| Perintah                                         | Fungsi                                                                     |
| :----------------------------------------------- | :------------------------------------------------------------------------- |
| `pnpm dev`                                       | Menjalankan aplikasi dalam mode pengembangan (`tsx src/index.ts`)          |
| `pnpm build`                                     | Memproses kompilasi TypeScript (`tsc`) ke folder `dist/`                   |
| `pnpm typecheck`                                 | Memeriksa error tipe TypeScript tanpa menulis file output (`tsc --noEmit`) |
| `pnpm lint`                                      | Memeriksa kepatuhan kode dengan aturan ESLint                              |
| `pnpm format`                                    | Melakukan formatting otomatis menggunakan Prettier                         |
| `pnpm add <pkg>`                                 | Menambahkan paket dependency baru                                          |
| `pnpm add -D <pkg>`                              | Menambahkan paket devDependency baru                                       |
| `pnpm install`                                   | Menginstall seluruh dependency berdasarkan `pnpm-lock.yaml`                |
| `pnpm version:show`                              | Menampilkan metadata versi Cosmos dari `version.json`                      |
| `pnpm version:check`                             | Validasi invarian `version.json` dan sinkronisasinya dengan `package.json` |
| `pnpm version:bump <patch\|feature\|generation>` | Menaikkan versi Cosmos sesuai Aturan S                                     |
| `pnpm run release:pre`                           | Publish rilis bertag dari `version.json` (lihat Aturan S)                  |

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
    4. `pnpm format` (**opsional** — CI `format.yml` menjalankan Prettier otomatis di `main` dan meng-push hasilnya; menjalankannya lokal hanya menghindari commit bot susulan. Lihat Rule AI)
    5. `pnpm run version:check` (wajib dijalankan untuk memastikan invarian `version.json` terpenuhi dan sinkron dengan `package.json`)
    6. `pnpm run version:bump <patch|feature|generation>` bila perubahan memerlukan increment versi — **wajib** pada setiap perubahan kode produk (lihat Aturan S.1).

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
- **Larangan Commit/Push `ISSUE.md` & `SUMMARY.md` (No Implicit ISSUE.md / SUMMARY.md Commit/Push):** File `ISSUE.md` (dokumen perencanaan/issue lokal) dan `SUMMARY.md` (ringkasan review) **DILARANG** untuk di-commit (`git add ISSUE.md`, `git add SUMMARY.md`, `git add -f`, atau ikut tercakup oleh `git add .` / `git add -A`) maupun di-`push` (termasuk saat force push) kecuali ada **perintah eksplisit dari pengguna** pada sesi berjalan. File-file ini sengaja dimasukkan ke `.gitignore`, sehingga AI Agent wajib memastikan file tersebut tidak ikut ter-stage; bila `git add .` berpotensi menyeretnya, gunakan staging selektif (`git add <path spesifik>`) alih-alih staging menyeluruh. Pengecualian hanya berlaku bila pengguna secara tegas memerintahkan commit/push file tersebut (misal: "commit ISSUE.md", "push SUMMARY.md").

---

## 4. Workflow Kerja AI Agent

1. **Pahami Kebutuhan:** Analisis permintaan pengguna dan periksa file terkait di `src/` atau panduan di `.agents/skills/`.
2. **Inspeksi Kode:** Selalu periksa file sumber asli sebelum mengubah logika atau nama fungsi/tipe.
3. **Eksekusi Perubahan:** Lakukan pengeditan kode secara presisi dan bersih dalam TypeScript.
4. **Jalankan Verifikasi:** Jalankan `pnpm typecheck` dan `pnpm lint` untuk memastikan tidak ada syntax error atau tipe mismatch.
5. **Format Kode (Opsional):** `pnpm format` tidak lagi wajib dijalankan secara lokal — CI `format.yml` memformat seluruh codebase di `main` secara otomatis (Rule AI). Menjalankannya lokal tetap dianjurkan agar tidak ada commit formatting susulan dari bot.
6. **Perbarui Metadata Versi (WAJIB):** Tentukan jenis increment berdasarkan tabel pada Aturan S.1, lalu jalankan `pnpm run version:bump patch|feature|generation` untuk memperbarui `version.json` (dan otomatis menyelaraskan `package.json`), kemudian jalankan `pnpm run version:check`. **Dilarang** melewati langkah ini bila perubahan menyentuh kode produk, konfigurasi, atau dokumentasi yang tercantum pada tabel trigger Aturan S.1.
7. **Lakukan Git Commit:** Lakukan commit lokal atas semua perubahan yang telah selesai dan terverifikasi beserta hasil formatting **dan seluruh file versi (`version.json`, `package.json`, `CHANGELOG.md`) dalam commit yang sama**. **Kecualikan `ISSUE.md` dan `SUMMARY.md`** — jangan di-stage atau di-commit kecuali pengguna memberi perintah eksplisit (lihat Aturan I).
8. **Ringkaskan Hasil:** Berikan penjelasan singkat, padat, dan jelas mengenai perubahan yang telah dilakukan, **termasuk versi Cosmos sebelum dan sesudah perubahan** beserta bukti verifikasi.

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
- **Safe Key Detection & Build Sync:** Deteksi kunci terjemahan WAJIB menggunakan `i18n.exists()`. File terjemahan JSON di `src/locales/` wajib disinkronkan ke `dist/locales/` saat proses build melalui `scripts/i18n/copy-locales.ts`. Rujuk panduan lengkap di `.agents/skills/i18n-localization-standards/SKILL.md`.

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

### S. Standar Versi Cosmos: Format Tanggal `G-F-P` (Cosmos Dated Versioning Standards)

> **Migrasi 2026-09-30:** Standar versi Cosmos **berubah** dari pasangan `RF-YYMM-BUILD` (pra-rilis) + SemVer (stabil) menjadi **satu format tanggal tunggal** `G<generation>-F<feature>-P<patch>`. Seluruh referensi `RF-*` dan SemVer pada aturan ini **DILARANG** digunakan lagi. spesifikasi lengkap ada di `docs/VERSIONING.md`.

- **Format Tunggal (Wajib `G<generation>-F<feature>-P<patch>`):** Seluruh versi Cosmos — pra-rilis maupun stabil — **wajib** menggunakan format `G<generation>-F<feature>-P<patch>` (misal: `G2-F24-P7`, `G1-F12-P2`). Format ini **menggantikan sepenuhnya** `RF-YYMM-BUILD` maupun SemVer.
- **Komponen Versi:**
    - `G` (**Generation**): naik pada perubahan arsitektur besar, restrukturisasi proyek, migrasi database mayor, penggantian framework utama, atau desain sistem yang tidak kompatibel dengan generasi sebelumnya (misal: `G2-F40-P12` → `G3-F1-P0`).
    - `F` (**Feature Milestone**): naik ketika sebuah fitur utama dinyatakan selesai dan siap dipakai (misal: `G2-F24-P0` → `G2-F25-P0`).
    - `P` (**Patch**): naik untuk perbaikan bug, penambahan validasi, optimasi, perbaikan UI, atau pembaruan dokumentasi penting (misal: `G2-F24-P0` → `G2-F24-P1`). Patch **reset ke `P0`** saat Feature Milestone naik.
- **Segmen Tanggal (Opsional):** Tanggal rilis opsional ditulis sebagai `.YYYY-MM-DD` (ISO 8601) dan menempel langsung pada nomor patch dengan satu titik (misal: `G1-F12-P2.2026-09-30`). Tanggal **tidak** dihitung sebagai increment versi, hanya mencatat kapan rilis terbit.
- **Status Rilis (Opsional):** Status developmental dapat ditambahkan di akhir (misal: `G2-F24-P7-alpha`, `G2-F24-P7-beta`, `G2-F24-P7-rc1`, `G2-F24-P7-stable`, `G2-F24-P7.2026-09-30-beta`). Urutan bila tanggal/status keduanya ada adalah `G-F-P.tanggal-status`.
- **Metadata Wajib pada `version.json` (JSON Terpusat):** Seluruh metadata versi disimpan di file `version.json` pada root repo agar mudah dikelola dan dipakai alat otomatis seperti CI/CD. **DILARANG** menyimpan versi hanya di `package.json` atau dokumentasi.
    ```json
    {
        "version": "G2-F24-P7",
        "generation": 2,
        "featureMilestone": 24,
        "patch": 7,
        "releaseDate": "2026-09-30"
    }
    ```
- **Invarian `version.json` (Dilarang Melanggar):**
    1. `version` **wajib** sama persis dengan `G${generation}-F${featureMilestone}-P${patch}`.
    2. `generation`, `featureMilestone`, dan `patch` **wajib** berupa bilangan bulat non-negatif.
    3. `releaseDate` **wajib** berformat ISO 8601 (`YYYY-MM-DD`) dan merupakan tanggal kalender yang valid.
    4. Field `version` pada `package.json` **wajib** selalu identik dengan `version.json` (divalidasi oleh `pnpm run version:check`).
- **Sumber Kebenaran & Pembacaan Programatik:** Versi **wajib** dibaca melalui utility terpusat `src/utils/versioning.ts` (`getVersionInfo()`, `formatVersion()`, `parseVersion()`, `bumpVersion()`, `compareVersions()`). Dilarang membaca `package.json` sebagai sumber versi, dan dilarang mem-parse versi dari `CHANGELOG.md` secara manual. Modul ini melakukan validasi invarian di atas dan melempar error deskriptif bila data rusak.
- **Kapan AI Agent WAJIB menaikkan versi (Kapan incremented):**
    | Situasi                                       | Increment                  | Contoh                    |
    | :-------------------------------------------- | :------------------------- | :------------------------ |
    | Perbaikan bug, validasi, optimasi, UI, docs   | `patch`                    | `G2-F24-P7` → `G2-F24-P8` |
    | Fitur utama selesai & siap pakai              | `feature` (patch reset)    | `G2-F24-P7` → `G2-F25-P0` |
    | Perubahan arsitektur mayor / migrasi DB mayor | `generation` (F & P reset) | `G2-F40-P12` → `G3-F1-P0` |
- **Tag Git:** Tag rilis **wajib** memakai string versi apa adanya tanpa prefiks tambahan, yaitu `G2-F24-P7` (tag `v`-prefixed dan SemVer **dilarang**). Workflow `.github/workflows/docker-publish.yml` memicu build image pada tag yang cocok dengan pola `G[0-9]*-F[0-9]*-P[0-9]*`.

#### S.1 Kebijakan Wajib Pembaruan `version.json` (Mandatory Version Metadata Update Policy)

> Kebijakan ini berlaku **mutlak** pada setiap AI Agent dan setiap kontribusi kode. Tujuannya memastikan metadata versi di `version.json` **tidak pernah** tertinggal dari perubahan kode.

- **Prinsip Utama (Source of Truth Commitment):** `version.json` adalah **komitmen versi** yang tercatat di dalam riwayat Git. Setiap perubahan yang mengubah perilaku produk **wajib** meninggalkan jejak pada `version.json` di dalam **commit yang sama**. Membiarkan `version.json` tidak tersentuh pada perubahan yang membutuhkan increment versi **dilarang keras**.
- **Kapan `version.json` WAJIB Diperbarui (Trigger Paths):** AI Agent **wajib** menjalankan `pnpm run version:bump <patch|feature|generation>` bila perubahan menyentuh salah satu path berikut:

    | Path yang Diubah                                                         | Increment    | Wajib?      |
    | :----------------------------------------------------------------------- | :----------- | :---------- |
    | `src/**`, `prisma/**`, `scripts/**`, `docker/**`, `.github/workflows/**` | `patch`      | **Ya** (CI) |
    | Penyelesaian fitur/command/subsistem baru yang siap dipakai              | `feature`    | **Ya**      |
    | Restrukturisasi mayor, migrasi DB mayor, penggantian framework           | `generation` | **Ya**      |
    | Perbaikan bug, validasi baru, optimasi, perbaikan UI/UX                  | `patch`      | **Ya**      |
    | `README.md`, `docs/**`, `AGENTS.md`, `.agents/**`                        | `patch`      | **Ya**      |
    | `*.md` lain, `ISSUE.md`, `SUMMARY.md`, format/typo/whitespace            | —            | **Tidak**   |

    Pipeline CI `.github/workflows/version-policy.yml` menegakkan baris bertanda **(CI)** secara otomatis dan akan **gagal** bila kode produk berubah tanpa `version.json` ikut berubah. Baris lainnya ditegakkan oleh kewajiban AI Agent dan tidak dideteksi otomatis.

- **Kapan `version.json` TIDAK perlu Diperbarui:** Penyuntingan teks, perbaikan format/whitespace, dan dokumentasi non-versi **tidak** memerlukan increment versi (sesuai aturan `P` di atas). Cukupkan dengan `pnpm run version:check` untuk memastikan metadata tetap valid dan sinkron.
- **Prosedur Wajib (Prosedur Wajib Setiap Commissioning):** Setiap kali menyelesaikan perubahan kode:
    1. [ ] Tentukan jenis increment berdasarkan tabel di atas.
    2. [ ] Jalankan `pnpm run version:bump patch|feature|generation` (atau `pnpm run release:pre -- --bump <jenis>` bila sekalian menerbitkan).
    3. [ ] Jalankan `pnpm run version:check` untuk memastikan invarian terpenuhi dan `package.json` sinkron.
    4. [ ] Pastikan `version.json` **sudah di-stage** dalam commit yang sama dengan perubahan kode.
    5. [ ] Tambahkan entri di `CHANGELOG.md` sesuai versi baru bila perubahan berdampak ke user.
- **Konsistensi `package.json`:** Siapa pun yang menaikkan versi **wajib** menjalankan `pnpm run version:bump` (script menyelaraskan `package.json` secara otomatis) **atau** menyelaraskan `package.json` secara manual di commit yang sama. Dilarang hanya mengubah `package.json` tanpa `version.json`, atau sebaliknya.
- **Pencegahan Lupa (Anti-Forget Guardrail):** Karena `version.json` bersifat text-based, CI menjadi penjaga terakhir. Job `version-policy` pada `.github/workflows/version-policy.yml` berjalan pada setiap push ke `main` dan setiap pull request, memanggil `pnpm run version:verify -- --base <base-sha>`. Perintah tersebut memastikan (a) `version.json` **berubah** setiap kali `src/**`, `prisma/**`, `scripts/**`, `docker/**`, atau `.github/workflows/**` berubah, dan (b) versi baru selalu **lebih besar** dari versi base (mencegah downgrade maupun versi duplikat). Kegagalan pada CI berarti ada perubahan kode yang belum menaikkan versi.
- **Verifikasi Manual (Setara dengan CI):** Sebelum push, AI Agent dapat menjalankan `pnpm run version:verify -- --base HEAD` untuk meniru perilaku CI secara lokal terhadap commit terakhir. Tambahkan `--against origin/main` untuk memeriksa tabrakan nomor versi dengan branch lain.
- **Tabrakan Versi Antar Branch Paralel (WAJIB):** `version:bump` membaca `version.json` **lokal**, sehingga dua PR yang bercabang dari commit yang sama akan menghitung versi berikutnya yang **identik**. Job `version-policy` menjalankan `pnpm run version:verify -- --base <base-sha> --against origin/<base-ref>` pada setiap pull request untuk menangkap tabrakan **saat PR masih terbuka**, bukan setelah merge ke `main`. Jika CI melaporkan `Version collision`, AI Agent **wajib** melakukan rebase lalu bump ulang (bukan memaksa merge):
    ```bash
    git fetch origin && git rebase origin/main
    pnpm run version:bump patch|feature|generation
    pnpm run version:check
    git commit -am "chore(versioning): rebump to <new version>" && git push --force-with-lease
    ```
    Aturan merge: **merge terakhir menang memakai nomor tertinggi**; nomor yang telah dialokasikan sebelum merge tidak dijamin bertahan. Rujukan lengkap ada di `.agents/skills/parallel-branch-versioning/SKILL.md` dan `docs/VERSIONING.md` bagian "Parallel Branches & Version Collisions".
- **Semantik Feature Milestone (`F`):** `F` adalah **penghitung milestone**, bukan daftar fitur. `G2-F24-P10` berarti "Generasi 2, 24 milestone fitur selesai, 10 patch sejak milestone 24" — angka ini **tidak** menyatakan bahwa kodebase berisi 24 fitur. Karena angka `F` tidak bersifat self-describing, setiap bump **`feature`** (yang menaikkan `F`) **wajib**: (a) menambahkan section `## [G<n>-F<m>-P0]` di `CHANGELOG.md` yang menyebut milestone tersebut, dan (b) menambahkan baris ke tabel registry milestone di `docs/VERSIONING.md`. Bump **`patch`** tidak menaikkan `F` sehingga tidak memerlukan entri registry baru. Rujukan lengkap ada di `.agents/skills/parallel-branch-versioning/SKILL.md`.
- **Otomasi Rilis:** Pembuatan tag dan penerbitan GitHub Release didelegasikan melalui `scripts/release/release.ts` (`pnpm run release:pre`). Script ini membaca `version.json`, menyelaraskan `package.json`, memvalidasi header `CHANGELOG.md`, lalu membuat tag dan GitHub Release. Flag penting: `--bump patch|feature|generation` untuk menaikkan versi sebelum publikasi, `--stable` untuk terbit tanpa flag `--prerelease`, `--dry-run` untuk validasi tanpa efek samping, dan `--no-push` untuk melewati push remote. Manajemen metadata harian (read/validate/bump) dilakukan `scripts/release/version.ts` melalui `pnpm run version:show`, `version:check`, dan `version:bump <patch|feature|generation>`.
- **Transisi & Riwayat:** Saat migrasi ke format `G-F-P`, riwayat header `RF-*` yang sudah terbit di `CHANGELOG.md` **tetap dipertahankan apa adanya** sebagai catatan siklus pra-rilis dan **tidak boleh diubah**. Rujukan lengkap ada di `.agents/skills/cosmos-versioning/SKILL.md`.

### T. Standar Menu Bot & Kompatibilitas Deskripsi Perintah i18n (Menu & Command Description i18n Standards)

- **Kompatibilitas Deskripsi Perintah (i18n Command Description):** Setiap deklarasi `ToolDefinition` di `src/tools/` **WAJIB** menyertakan atribut `descriptionKey` (berformat `tools.commands.<clean_name>.description`) selain `description` default berbahasa Inggris untuk keperluan Groq LLM tool calling. Seluruh deskripsi perintah wajib didaftarkan secara simetris di `src/locales/en/tools.json` dan `src/locales/id/tools.json` pada objek `"commands"`.
- **Resolusi Deskripsi Dinamis:** Penampilan deskripsi perintah pada menu dan panduan bantuan (`.menu`, `.help`, `.menu <category>`, `.help <command>`) **WAJIB** diselesaikan secara dinamis melalui helper `resolveToolDescription(tool, t)` atau `menuService.getToolDescription(tool, t)` agar bahasa deskripsi dirender sesuai preferensi bahasa pengguna/obrolan (`ctx.t`).
- **Modern Hero Banner & Baileys ExternalAdReply:** Seluruh respon tampilan menu bot (`.menu`, `.help`) **WAJIB** dikirimkan via Baileys `externalAdReply` dengan atribut `renderLargerThumbnail: true`, memanfaatkan buffer thumbnail aman dari `getMenuBannerBuffer()` (otomatis fallback ke placeholder jika file kosong/rusak), serta mengembalikan `undefined` untuk mencegah echo duplikasi pesan pada pipeline handler.

### U. Subsistem Sub-Bot Multi-Device (Cosmos Sub-Bot Multi-Device Architecture Standards)

- **Isolasi Database & Schema Auto-Bootstrap:** Setiap sub-bot wajib memiliki basis data SQLite mandiri pada path `database/{phoneNumber}/database.sqlite`. Inisialisasi skema basis data wajib menggunakan fungsi `ensureDatabaseSchema` berbasis DDL `better-sqlite3` agar tabel dapat terbuat otomatis tanpa bergantung pada Prisma CLI engine (terutama di lingkungan Android Termux/PRoot).
- **Proteksi Lifecycle & Isolasi Error:** Eksekusi `process.exit(1)` pada event diskoneksi/logout Baileys **HANYA DIPERBOLEHKAN** untuk sesi utama (`sessionId === 'default'`). Sesi sub-bot yang terputus atau logout **DILARANG KERAS** memicu _process exit_ pada proses induk.
- **Proteksi Race Condition Pairing & Pembatalan Asinkron:** Karena inisialisasi socket Baileys bersifat asinkron (menunggu `fetchLatestBaileysVersion` & `usePrismaAuthState`), pembuatan koneksi wajib memvalidasi flag `isAborted()` sebelum dan sesaat setelah socket diinisialisasi. Saat pengguna mengetik `.cancel`, fungsi `abortPairing` wajib membersihkan timer dan memutus socket baik dari referensi sementara (`tempSock`) maupun dari `activeConnections`.
- **Resolusi Kunci API Bertingkat & Masking Kredensial:** Seluruh konsumsi AI pada sub-bot wajib menyelesaikan API key dengan urutan `Sub-Bot Custom Key -> Parent Bot Fallback`. Tampilan kunci API wajib disamarkan (`gsk_••••••••9aB2`) dan wajib menyertakan peringatan keamanan jika dikonfigurasi melalui grup publik.
- **Anti-Recursion Guard & 4-Tier Language Resolution:** Sub-bot dilarang keras memicu _pairing_ untuk membuat sub-bot sekunder (_anti-recursion_). Resolusi bahasa pesan wajib mematuhi hierarki 4 tingkat: `WhitelistedGroup -> User -> SubBot config -> 'id'`. Rujuk panduan lengkap di `.agents/skills/subbot-multidevice-architecture/SKILL.md`.

### V. Arsitektur Produksi Kontainer Tunggal (Single-Container Production Standards)

- **Multi-Stage Containerization:** Cosmos memaketkan 3 aplikasi mandiri (WhatsApp Bot di `main`, Fastify API Gateway di `api`, dan Next.js Web Portal di `website`) ke dalam satu kontainer Docker produksi `cosmos-origin` yang disupervisi oleh PM2 dan Nginx non-root.
- **Non-Root & Unprivileged Nginx:** Runner Docker wajib berjalan di bawah user non-root `cosmos` (UID 1001). Nginx wajib menggunakan direktori sementara `/tmp/*` (`client_body_temp_path`, dll.) dan direktif `user` di level root Nginx dilarang digunakan.
- **Next.js Standalone Loopback Binding:** Pada PM2 runtime, service `cosmos-web` **WAJIB** mengekspor `HOSTNAME: '0.0.0.0'` agar server standalone Next.js mengikat ke loopback kontainer dan dapat diakses oleh reverse proxy Nginx (`127.0.0.1:3000`).
- **Cloudflare Ingress & Turnstile:** Akses publik dikelola melalui Cloudflare Tunnel outbound (`cloudflared --url http://127.0.0.1:80`). Variabel frontend `NEXT_PUBLIC_TURNSTILE_SITE_KEY` wajib diinjeksikan via Docker build argument (`ARG`), sedangkan secret backend `CLOUDFLARE_TURNSTILE_SECRET_KEY` diinjeksikan saat runtime via `.env`. Rujuk panduan lengkap di `.agents/skills/single-container-production-deployment/SKILL.md`.

### W. Presedensi Migrasi Programmatic DDL SQLite (SQLite Schema Migration Precedence Standards)

- **Aturan Urutan DDL Wajib:** Dilarang mendeklarasikan `CREATE INDEX` untuk kolom migrasi baru di dalam blok SQL awal sebelum kolom tersebut dijamin keberadaannya. Pada database yang sudah ada sebelumnya, `CREATE TABLE IF NOT EXISTS` tidak akan dieksekusi sehingga pembuatan indeks akan langsung melempar error fatal `no such column` dan memutus seluruh migrasi.
- **3-Phase Execution:** Urutan eksekusi migrasi programmatic `better-sqlite3` wajib mengikuti:
    1. `CREATE TABLE IF NOT EXISTS` (hanya kolom & indeks bawaan).
    2. `ensureColumnExists(db, table, column, def)` untuk setiap kolom tambahan bertahap.
    3. `CREATE INDEX IF NOT EXISTS` dibungkus dalam blok `try/catch` mandiri setelah penambahan kolom berhasil.
- **Dual-Maintenance Simetris:** Setiap perubahan skema SQLite wajib diperbarui secara simetris di kedua file driver: `src/db.ts` (Bot) dan `.worktrees/api/src/db.ts` (API Gateway). Rujuk panduan lengkap di `.agents/skills/sqlite-schema-migration-precedence/SKILL.md`.

### X. Isolasi Worktree pada Tooling Linter & Formatter (Worktree Tooling Isolation Standards)

- **Worktree Exclusion:** Direktori git worktree (misal: `.worktrees/**`) **WAJIB** diabaikan secara eksplisit pada konfigurasi ESLint (`eslint.config.js`), Prettier (`.prettierignore`), dan Git (`.gitignore`) di level root. Hal ini wajib dilakukan guna mencegah konflik parser atau bentrok dependensi plugin (seperti `eslint-plugin-react` vs ESLint flat config) yang berasal dari branch proyek frontend/API lain.

### Y. Larangan Kredensial Fabrikasi (No Fabricated Credentials Standards)

- **Kredensial Real Saja:** API/website **DILARANG** mengembalikan kredensial hasil `crypto.randomBytes`, mock hardcode (`'COSMOS-88'`), atau SVG/QR palsu untuk operasi yang hanya bisa diterbitkan oleh engine (pairing code Baileys, QR login). Saat engine tidak terjangkau, kembalikan `503 BOT_OFFLINE`.
- **Bridge IPC Wajib:** Aksi web yang membutuhkan socket hidup (pairing sub-bot, pengiriman pesan) **WAJIB** diteruskan ke bot via socket IPC Unix mengikuti pola `sendIpcCommand` + handler `/internal/...`, dengan timeout yang diukur per operasi. Rujuk panduan di `.agents/skills/web-bot-ipc-bridge/SKILL.md`.

### Z. Verifikasi Deploy Kontainer (Container Deploy Verification Standards)

- **Samakan Image:** Setelah `docker compose build`, **WAJIB** membandingkan ID image kontainer berjalan vs `cosmos-origin:latest` (`docker inspect` vs `docker images --no-trunc`) dan menjalankan `docker compose up -d` bila berbeda sebelum mengklaim perbaikan sudah live.
- **Bukti di Bundle Berjalan:** Keberadaan perbaikan wajib dibuktikan dengan `grep` string literal di `/app/website/.next/`, `/app/bot/dist`, atau `/app/api/dist` **di dalam kontainer yang berjalan**, plus cek `pm2 list` dan `curl` ke rute terkait. Rujuk panduan di `.agents/skills/container-deploy-verification/SKILL.md`.

### AA. Rebuild & Redeploy Otomatis Setiap Perubahan Kode (Mandatory Container Rebuild on Code Changes)

- **Selalu Build + Deploy:** Setiap ada perubahan kode pada salah satu dari tiga aplikasi (Bot Engine di root, API Gateway di `.worktrees/api`, Web Portal di `.worktrees/website`) yang ditujukan untuk produksi, AI Agent **WAJIB** menuntaskannya sampai live: verifikasi per worktree (`typecheck` + `lint` + `build` + test bila ada) → commit lokal → `docker compose build cosmos-origin` → `docker compose up -d` → verifikasi sesuai Aturan Z. Dilarang berhenti hanya pada commit. Shortcut: `pnpm docker:deploy` (root `package.json`) menjalankan seluruh alur build → up → recreate-bila-berubah → verifikasi.
- **Pengecualian Docs-Only:** Perubahan yang tidak masuk image Docker (`.agents/skills/*`, `*.md`/AGENTS.md, `.env` yang di-gitignore) tidak memerlukan rebuild — kecuali `.env` mengubah variabel `NEXT_PUBLIC_*` (bake-time), maka rebuild **tetap wajib**.
- **Cek Disk Dulu:** Sebelum build, cek `df -h /` dan `docker system df`; bila sempit, jalankan `docker builder prune -f` terlebih dahulu (build berikutnya full dan lambat). Kegagalan khas: `failed to extract layer ... no space left on device`.

### AB. Subsistem AI Agent Runtime (CosmosAgentEngine Standards)

- **Two-Tier Guidance + Execution Dual-LLM:** Seluruh konsumsi tool calling AI wajib dipisahkan menjadi dua tier: Tier 1 Analytical Guidance Planner (model kecil berkecepatan tinggi dengan prompt terstruktur & format JSON untuk ekstraksi intent & resolusi alias) dan Tier 2 Persona Executor (model penalaran tinggi dengan persona Sara, batasan anti-XML, dan injeksi skema tool tunggal).
- **Zero-Knowledge Contact Nonce:** Nomor telepon pribadi DILARANG KERAS diekspos ke prompt LLM. Kontak wajib dipetakan ke 128-bit ephemeral nonces (`contact_ref_...`) di server RAM dengan TTL 3 menit, terikat ketat ke `callerJid`, dilindungi batas kapasitas LRU 10.000 token, dan disimpan terenkripsi AES-256-GCM pada tabel `UserContactBook`.
- **Policy Gate & Self-Healing Re-Validation:** Seluruh tool recovered dari Groq `tool_use_failed` (`error.failed_generation`) WAJIB divalidasi ulang melalui TypeScript Policy Gate dan RBAC sebelum dieksekusi guna mencegah eksploitasi injeksi prompt.
- **Konfirmasi Interaktif & Perlindungan TOCTOU:** Seluruh mutasi finansial (`bank_action`, `transfer`, `loan`) wajib melalui konfirmasi interaktif 2-fase (`AgentConfirmationManager` terintegrasi dengan `cancellationManager`), memvalidasi kecocokan JID/LID pengonfirmasi, dan mengevaluasi ulang saldo secara atomik di dalam `prisma.$transaction`.
- **Delegasi Lokasi Jarak Jauh & Sanitasi Nomor:** Delegasi lokasi via bot wajib menyertakan caption atribusi sender (`"${senderName} sent this from a different number — Sara AI"`). Input nomor telepon wajib melewati sanitasi multi-token (E.164, strip `00`, normalisasi `08` -> `628`, koreksi `6208`). Rujuk panduan lengkap di `.agents/skills/cosmos-agent-engine/SKILL.md`.

### AC. Standar Ekstraksi String & Monospace WhatsApp (WhatsApp Monospace Filtering Standards)

- **Utility Terpusat (`monospace.ts`):** Seluruh parsing argumen perintah yang memerlukan pemisahan parameter berisiko spasi (seperti alias kontak) atau isolasi teks harfiah (seperti teks brat tanpa terpicu keyword animasi) **WAJIB** menggunakan helper `extractLeadingMonospace` atau `unwrapMonospace` dari `src/utils/monospace.ts`.
- **Dukungan Monospace WhatsApp:** Sistem wajib mendukung format monospace triple backtick (` ```...``` `) dan inline backtick (`` `...` ``) serta kutipan tanda petik ganda/tunggal (`"..."`, `'...'`) secara konsisten. Rujuk panduan di `.agents/skills/whatsapp-monospace-filtering/SKILL.md`.

### AD. Perencanaan Issue & Prosedur Pembuatan GitHub Issue via ISSUE.md (Issue Planning & GitHub Issue Creation Standards)

- **Perencanaan Wajib di `ISSUE.md` (Mandatory Planning in `ISSUE.md`):** Setiap kali merencanakan pembaruan (updates), perbaikan bug (khususnya perbaikan bug berskala besar atau menengah / major & medium-sized bugs), maupun penambahan fitur dan command baru, AI Agent **WAJIB** membuat dan menuangkan seluruh rencana kerja, analisis, serta spesifikasinya terlebih dahulu di dalam file `ISSUE.md`.
- **Prosedur Pembuatan GitHub Issue (Pre-creation & User Review Gate):** Apabila hendak membuat GitHub Issue, AI Agent **WAJIB** menyusun draf issue tersebut terlebih dahulu di dalam file `ISSUE.md` dan menunggu peninjauan (_user review_) dari pengguna. Dilarang langsung membuat issue di GitHub tanpa melalui tahap ini.
- **Persetujuan atau Instruksi Pengguna (Explicit Approval / Instruction Required):** AI Agent hanya boleh membuat GitHub Issue di repositori GitHub apabila pengguna telah memberikan persetujuan (_approved_) terhadap draf di `ISSUE.md` atau secara eksplisit menginstruksikan untuk menerbitkannya sebagai GitHub Issue.
- **Kepatuhan Template Issue GitHub (Mandatory Issue Template Compliance):** Setiap draf issue (baik di dalam `ISSUE.md` maupun saat diunggah/dibuat di GitHub) **WAJIB** mengikuti panduan dan struktur template resmi di `.github/ISSUE_TEMPLATE/` (misalnya `bug_report.md` dengan awalan judul `[BUG] ` serta bagian langkah reproduksi, perilaku yang diharapkan, log/stack trace, dan informasi environment; atau `feature_request.md` dengan awalan judul `[FEATURE] ` serta bagian deskripsi masalah, usulan solusi, dan alternatif yang dipertimbangkan). Dilarang membuat issue tanpa mengikuti format template yang berlaku.

### AE. Ringkasan Review Issue & Pull Request via SUMMARY.md (Issue & Pull Request Review Summary Standards)

- **Ringkasan Wajib di `SUMMARY.md` (Mandatory Review Summary in `SUMMARY.md`):** Setiap kali AI Agent selesai meninjau (_review_) sebuah issue atau pull request (PR), AI Agent **WAJIB** menyertakan dan mencatat ringkasan (_summary_) hasil tinjauan tersebut ke dalam file `SUMMARY.md`.
- **Analisis Lanjutan & Kolaborasi AI/User (Persistent Context for Users & AI Systems):** Tujuan pencatatan ini adalah agar pengguna lain maupun sistem AI berikutnya dapat dengan mudah menganalisis, memahami riwayat keputusan teknis, temuan masalah/risiko, atau status evaluasi review di masa mendatang tanpa kehilangan konteks.
- **Format Dokumentasi Terstruktur:** Ringkasan review pada `SUMMARY.md` setidaknya mencakup identitas issue/PR (nomor/judul), cakupan atau tujuan perubahan, temuan/evaluasi utama, kesimpulan/status rekomendasi review, serta tindak lanjut (_action items_) yang diperlukan.
- **Isolasi Git & Larangan Commit/Push:** Mengikuti Aturan I dan `.gitignore`, file `SUMMARY.md` (bersama `ISSUE.md`) bersifat lokal dan **DILARANG** di-stage, di-commit, atau di-push ke remote repository kecuali terdapat instruksi tegas dari pengguna.

### AF. Standar Nama Perintah Menggunakan Spasi (Spaced Command Names Standards)

- **Mandatory Spaced Command Names (Aturan Wajib Nama Perintah Berspasi):** Setiap deklarasi perintah atau command baru maupun yang diperbarui **WAJIB** menggunakan nama perintah yang memuat spasi (minimal dua kata, berformat multi-token, misal: `.apply license`, `.daily claim`, `.bank deposit`, `.bank withdraw`, `.loan apply`, `.shop buy`, `.my plan`, `.user profile`), bukan perintah satu kata tunggal (seperti `.buy`, `.bank`, `.loan`, `.daily`).
- **Pola Semantik Terstruktur:** Penamaan nama perintah wajib mengikuti konvensi `<domain> <action>` (misal: `bank deposit`, `loan apply`, `shop buy`) atau `<action> <target>` (misal: `apply license`, `register id`, `daily claim`, `cancel session`).
- **Simetri Aliases & Multibahasa:** Setiap tool wajib mendaftarkan alias multi-kata berspasi dalam bahasa Inggris dan bahasa Indonesia pada field `aliases` dan `displayNames` (`{ en: '...', id: '...' }`).
- **Resolusi Greedy Longest-Prefix Matching:** Parser pesan bot pada `message.ts` dan tool handler wajib menggunakan pencocokan prefix terpanjang (_greedy longest-prefix matching_) dari token pesan untuk mengekstrak `commandName`, serta meneruskan sisa karakter setelah nama perintah sebagai `argsStr` dan `args`.
- **Larangan Pemotongan Token Kaku (No Rigid Token Slicing):** Dilarang melakukan parsing argumen di dalam tool dengan mengasumsikan indeks posisi kata kaku dari teks pesan mentah (`parts[1]`); selalu gunakan objek `args` atau substring `argsStr` sisa.
- **Sintaks Bantuan & Dokumentasi Menu:** Seluruh panduan bantuan (`.menu`, `.help`), tutorial, dan contoh pemanggilan perintah wajib menampilkan format nama perintah lengkap dengan spasi (misal: `.daily claim` alih-alih `.daily`). Rujuk panduan lengkap di `.agents/skills/spaced-command-names/SKILL.md`.

### AG. Integrasi Model Keputusan Laya AI System One (Laya AI Decision Engine Standards)

- **Zero-Knowledge Data Masking:** Dilarang keras mengirimkan PII, nomor telepon mentah (`+62...`), raw JID (`...@s.whatsapp.net`, `...@g.us`), maupun nominal saldo rekening mentah ke endpoint upstream Laya System One. Seluruh string obrolan wajib disanitasi menggunakan `DecisionClient.sanitizeUntrustedContent()` dan alias wajib dipetakan ke ephemeral RAM nonces (`contact_ref_...`).
- **Larangan Rute Terbuka Generic `/raw`:** API Gateway dilarang menyediakan rute proksi generic `/raw`. Seluruh endpoint keputusan (`/api/v1/decision/intent`, `/api/v1/decision/loan`) wajib divalidasi dengan skema Zod ketat, dilindungi autentikasi (JWT / secret internal IPC), serta diberi pembatas laju panggilan (rate limit).
- **Circuit Breaker & Graceful Fallback:** Seluruh panggilan eksternal ke upstream decision engine wajib dibatasi timeout maksimal 3 detik (`AbortSignal.timeout(3000)`). Apabila terjadi error atau timeout, circuit breaker aktif selama 60 detik dan sistem wajib langsung jatuh tempo (fallback) ke Tier 1 Guidance Planner, Groq Native Function Calling, atau aturan deterministik tanpa memblokir socket loop Baileys.
- **Dual-Gate Safety & Pembatasan Kode:** Hasil evaluasi Laya hanya bertindak sebagai sinyal rekomendasi (advisory signal) dan dilarang mengubah state basis data secara langsung. Seluruh parameter keuangan wajib tetap tunduk pada batasan kode (bunga 2%–15%, tenor 7–30 hari, ACID `$transaction`). Rujuk panduan lengkap di `.agents/skills/laya-ai-decision-engine/SKILL.md`.

### AH. Cosmos MCP Server untuk AI Coding Agent (Cosmos MCP Server Standards)

> Implementasi lengkap atas GitHub Issue #49. Kode: `src/mcp/`. Dokumentasi operator: `docs/COSMOS_MCP.md`. Panduan agent: `.agents/skills/cosmos-mcp/SKILL.md`.

- **Operasional Kosmos WAJIB lewat MCP Tool (Hard Rule):** Setiap operasi yang menyentuh Cosmos — membaca/menulis basis data, mengatur konfigurasi, memancarkan pesan, menyiarkan pengumuman, atau memeriksa kesehatan bot — **WAJIB** dilakukan melalui tool `cosmos_db_*`, `cosmos_*`, atau `cosmos_bot_*`. AI Agent **DILARANG** menggunakan `npm`/`npx`/`yarn` (proyek ini PNPM-only), **DILARANG** menginstall paket CLI ad-hoc, **DILARANG** menulis skrip sekali-pakai (throwaway script) untuk menyelesaikan tugas Cosmos, dan **DILARANG** membuka berkas SQLite secara langsung atau menulis SQL mentah.
- **Tool-Selection Guidance (Intent → Tool):** Pemetaan intent ke tool bersifat wajib dan dapat queried langsung lewat tool `cosmos_guidance`. Contoh kunci: intent "broadcast announcement ke semua grup" → `cosmos_bot_broadcast` (bukan skrip custom); intent "update baris database" → `cosmos_db_describe` → `cosmos_db_mutation_plan` → `cosmos_db_apply_mutation` (bukan SQL mentah).
- **Anchor Anti-Halusinasi:** `cosmos_db_describe` mengembalikan katalog model live yang diparsing dari `prisma/schema.prisma`. Kolom yang tidak tercantum di sana **tidak ada**; `cosmos_db_mutation_plan` dan `cosmos_db_apply_mutation` akan menolak kolom yang tidak dikenal dengan `UNKNOWN_FIELD`-style blocker. Dilarang menebak nama kolom.
- **Kill-Switch pada Mutasi:** `cosmos_db_apply_mutation` hanya berjalan bila `cosmos_db_mutation_plan` mengembalikan `safe: true` untuk request yang identik byte-per-byte (dibuktikan lewat `planFingerprint`). Mutasi destruktif (`delete`) memerlukan `confirm: true` serta pratinjau jumlah baris, dan dibatasi oleh `COSMOS_MCP_MAX_BULK_DELETE_ROWS`.
- **Akses Single-Owner API Key (Fail Closed):** Seluruh permukaan MCP diautentikasi oleh **tepat satu** API key yang dipegang oleh repository owner secara pribadi (`COSMOS_MCP_TOKEN`). Tidak ada key per-user, per-agent, per-workspace, atau per-client; tidak ada signup mandiri, tidak ada rotasi otomatis, tidak ada jalur pemulihan kedua, dan tidak ada backdoor. **Hanya owner yang dapat me-reset atau merotasi key.** Perbandingan wajib constant-time melalui `timingSafeStringCompare`; key tidak boleh pernah muncul di respons tool, error, `console.log`, maupun baris log Pterodactyl. Bila key kosong/tidak terkonfigurasi, server **WAJIB gagal start** atau mengembalikan `401 UNAUTHORIZED_MCP` — **DILARANG** jatuh ke akses anonim, key default, key dev, atau bypass untuk pemanggil loopback. Loopback binding adalah higiene transport, **bukan** pengganti otorisasi.
- **Audit Holder, Bukan Key:** Setiap mutasi merekam `ActivityLog` berisi identitas pelaku (`repository-owner`), nama tool, dan diff sebelum/sesudah. Credential tidak pernah dicatat, sehingga jejak audit tetap utuh setelah rotasi.
- **Jaminan Independensi Workspace:** MCP server berjalan dari deployment Cosmos (PM2 `cosmos-mcp`, stdio atau Streamable HTTP loopback), sehingga agent di fresh clone, di `.worktrees/api`, atau di mesin lain memiliki kapabilitas yang identik tanpa `node_modules`, Prisma client, atau `dist/` lokal.
- **Privasi Kontak (Zero-Knowledge):** Nomor telepon dan JID mentah tidak boleh keluar dari server. Semua JID dikembalikan dalam bentuk masked beserta alias ephemeral `contact_ref_...` (TTL 3 menit, LRU 10.000 token, hanya di RAM) yang dapat dikembalikan agent untuk diresolusi server-side. Rujuk `src/mcp/privacy.ts`.
- **Nol Data Palsu (Rule Y):** Setiap tool yang membutuhkan engine live wajib mengembalikan `BOT_OFFLINE` apabila engine tidak terjangkau — dilarang memalsukan keberhasilan, pairing code, maupun QR.
- **Persisted Queue untuk Fan-Out (Rule J):** `cosmos_bot_broadcast` menyimpan job dan satu baris delivery per target beserta jadwal `nextAttemptAt` yang berjenjang, sehingga fan-out multi-jam tetap bertahan melewati restart. Jadwal **DILARANG** menggunakan `setTimeout` in-memory. Pembatalan didukung melalui `cosmos_bot_broadcast_cancel` maupun perintah `.cancel` (`cancellationManager`).
- **Read-Only Deployment Mode:** `COSMOS_MCP_READ_ONLY=true` **meng-compile seluruh toolset mutasi keluar** dari server (bukan sekadar menolak saat dipanggil), sehingga aman dipasang terhadap produksi.
- **Rate Limit & Konkurensi:** Setiap identitas memiliki sliding window untuk total panggilan dan mutasi, plus ceiling konkurensi mutasi. Pelanggaran menghasilkan `RATE_LIMITED`.
- **Bridge IPC Wajib (Rule Y):** Seluruh aksi bot live wajib diteruskan ke engine melalui `sendIpcCommand` pada handler `/internal/...`. Pairing code dan QR **hanya** dapat diterbitkan oleh engine; MCP hanya mem-proxy nilai riil.
- **Audit Trail i18n & Formal English:** Seluruh string output tool (deskripsi, pesan error, log, dan `cosmos_guidance`) WAJIB ditulis dalam **Bahasa Inggris Formal** (Rule H). Rujukan lengkap: `docs/COSMOS_MCP.md`.

### AI. Otomatisasi Versi & Rilis CI (Version & Release CI Automation Standards)

> Implementasi: `.github/workflows/version-automation.yml`, `release.yml`, `version-policy.yml`. Panduan agent: `.agents/skills/version-release-automation/SKILL.md`.

- **Rantai Otomatis (Pipeline Chain):** Merge/push ke `main` → `version-automation.yml` mengklasifikasi (nothing | tag-only | bump) → bump + commit `[skip ci]` + push tag → tag memicu `release.yml` (GitHub Release berisi irisan `CHANGELOG.md`) dan `docker-publish.yml` (image GHCR). `version.json` tetap satu-satunya sumber kebenaran. Selain itu `format.yml` menjalankan Prettier ke seluruh codebase pada setiap push ke `main` dan meng-push hasilnya sebagai `github-actions[bot]` dengan `[skip ci]`, sehingga formatting tidak lagi wajib dijalankan di sisi development (kedua workflow diserialkan lewat concurrency group `main-automation`).
- **Klasifikasi Bump Berbasis Commit Message (Smart Classification):** Bila path bervedisi berubah tanpa `version.json` ikut berubah, workflow membaca commit message: `BREAKING CHANGE` / `type!:` → `generation`; subject `feat:`/`feat(scope):` → `feature`; lainnya → `patch`. Prioritas tertinggi menang dalam satu push.
- **Kejujuran Tipe Commit (WAJIB):** Karena klasifier membaca commit message, AI Agent **WAJIB** menulis tipe commit secara jujur: `feat:` hanya untuk fitur selesai, `!:`/`BREAKING CHANGE` untuk breaking change, dan **DILARANG** menyalahgunakan `feat:` untuk mempercepat kenaikan `F`. Subject commit menjadi bahan baku catatan rilis dan nama milestone — tulis yang layak tampil publik.
- **Bump Manual di PR Tetap Wajib:** Otomasi tidak menghapus kewajiban Rule S.1; PR tetap menjalankan `version:bump` + entri CHANGELOG tulisan manusia. Setelah merge, workflow hanya menag (mode tag-only). Auto-bump hanyalah jaring pengaman untuk direct push.
- **Larangan:** Dilarang membuat tag/rilis manual untuk perubahan rutin (tag yang tidak cocok dengan `version.json` gagal fail-closed di `release.yml`), mengedit commit auto-bump `[skip ci]`, atau mengubah workflow tanpa bump `patch`.
- **Override Manual:** Salah klasifikasi akibat commit salah ketik dikoreksi via `workflow_dispatch` (pilih patch/feature/generation), **bukan** dengan rewrite history `main`.
- **Tabrakan Versi:** Prosedur rebase-lalu-rebump pada Rule S.1 tetap berlaku; otomasi hanya menag versi yang menang merge.
- **Recursion Guard & Publikasi via API:** Git push (termasuk dengan PAT `RELEASE_TOKEN`) **tidak** menjamin `release.yml`/`docker-publish.yml` terpicu (batasan GitHub yang teramati). Oleh karena itu `version-automation.yml` menyelesaikan rantai sendiri lewat Actions API dengan `GITHUB_TOKEN`: `gh release create` (dengan irisan `CHANGELOG.md`) dan `gh workflow run 'Publish Docker Image to GHCR'`. `docker-publish.yml` mendukung `workflow_dispatch` dengan input `tag` serta concurrency per-tag. PAT `RELEASE_TOKEN` kini opsional (tag tetap di-push lewat PAT bila tersedia).
