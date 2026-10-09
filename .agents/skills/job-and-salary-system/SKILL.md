---
name: job-and-salary-system
description: >
    Panduan baku arsitektur dan implementasi Subsistem Pekerjaan dan Gaji (Job & Salary System) Cosmos, mencakup katalog profesi, persyaratan ID Card & item/lisensi, perhitungan gaji dinamis berbasis EconomyMultiplier makroekonomi, pelacakan cooldown shift, serta standar versi rilis (format tanggal `G-F-P` melalui metadata `version.json`).
---

# Cosmos Job & Salary System Standards

## 1. Ringkasan & Konteks

Subsistem Pekerjaan dan Gaji (**Job & Salary System**) adalah fitur perkembangan ekonomi non-perjudian pada Cosmos WhatsApp Bot framework (`src/services/jobs.ts`, `src/commands/employment/job.ts`, `src/commands/employment/work.ts`). Sistem ini memberikan alternatif bagi pengguna untuk mendapatkan saldo (`balance`) secara konsisten melalui shift kerja dan dividen usaha yang nilainya berfluktuasi mengikuti kondisi makroekonomi riil.

Fitur utama meliputi:

1. **Katalog Karier Terstruktur**: Mendukung berbagai jalur profesi dengan siklus pembayaran, risiko, dan variasi pendapatan berbeda (Mining, Office Work, Taxi Driving, Cooking, Gojek, Entrepreneurship).
2. **Kompensasi Dinamis Berbasis Inflasi**: Gaji pokok dikalikan dengan `EconomyMultiplier` dari tabel database yang diperbarui secara otomatis oleh AI berdasarkan kurs valuta asing USD/IDR dari API EODHD.
3. **Gerbang Wajib KTP (Virtual ID Card Gate)**: Memeriksa kepemilikan KTP (`requireIdCard`). Pengguna tanpa KTP dilarang melamar pekerjaan atau bekerja.
4. **Persyaratan Inventaris & Lisensi**: Validasi kepemilikan alat pendukung (Pickaxe, MacBook, iPhone, SIM / Driver's License) sebelum lamaran diterima atau shift dieksekusi.
5. **Pelacakan Cooldown Shift Atomik**: Menggunakan field `lastWorkedAt` dan `cooldownMinutes` untuk mencegah spam perintah `.work`.
6. **Pencatatan Audit Ledger**: Setiap pendapatan gaji dicatat ke model `ActivityLog` (`type: 'JOB_SALARY'`).
7. **Standar Penomoran Versi & Rilis `G-F-P`**: Format penomoran versi framework memakai skema `G<generation>-F<feature>-P<patch>` dengan metadata terpusat pada `version.json`, dikelola melalui `scripts/release/version.ts` dan dipublikasikan melalui `scripts/release/release.ts`.

---

## 2. Arsitektur Model Database (`prisma/schema.prisma`)

```prisma
model JobCatalog {
  id              Int     @id @default(autoincrement())
  name            String  @unique // Contoh: 'Mining', 'Office Work'
  description     String
  baseSalary      BigInt  // Gaji pokok sebelum pengali ekonomi
  cooldownMinutes Int     @default(60)
  requiredItemId  String? // Id atau shortId item (misal: 'pickaxe', 'macbook')
  isActive        Boolean @default(true)

  workers         User[]
}

model User {
  // ... field lainnya ...
  currentJobId   Int?
  currentJob     JobCatalog? @relation(fields: [currentJobId], references: [id], onDelete: SetNull)
  lastWorkedAt   DateTime?   // Pelacak cooldown shift kerja .work
}
```

---

## 3. Karakteristik & Aturan Jalur Profesi (Career Tracks)

| Profesi              | Gaji Pokok Dasar     | Cooldown            | Persyaratan Wajib                                             | Karakteristik & Varian Shift                                                                                           |
| :------------------- | :------------------- | :------------------ | :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| **Mining**           | Rp333.333 / hari     | 1.440 mnt (24 jam)  | Virtual ID Card + `pickaxe`                                   | Variansi tinggi: Diamond (10%, Rp666.666), Gold (20%, Rp333.333), Coal (40%, Rp233.333), Iron (30%, Rp166.666).        |
| **Office Work**      | Rp250.000 / hari     | 1.440 mnt (24 jam)  | Virtual ID Card + `macbook`                                   | Penghasilan stabil tugas korporat dan pemrograman harian.                                                              |
| **Taxi Driving**     | Rp133.333 / hari     | 1.440 mnt (24 jam)  | Virtual ID Card + `driver_license`                            | Shift harian mengantar penumpang melintasi kota.                                                                       |
| **Cooking**          | Rp150.000 / hari     | 1.440 mnt (24 jam)  | Virtual ID Card                                               | Memasak menu restoran saat shift makan siang & malam.                                                                  |
| **Gojek**            | Rp2.500 / order      | 60 mnt (1 jam)      | Virtual ID Card                                               | Gig economy on-demand, frekuensi tinggi dengan tip acak (Rp500–Rp1.500).                                               |
| **Entrepreneurship** | Rp1.250.000 / minggu | 10.080 mnt (7 hari) | Virtual ID Card + (`macbook` atau `iphone`) + Modal Rp250.000 | Dividen mingguan dengan variasi pasar: Boom (15%, 1.8x), Normal (65%, 1.0x-1.3x), Lean (15%, 0.4x), Defisit (5%, Rp0). |

---

## 4. Perhitungan Payout Dinamis (Dynamic Salary Engine)

Setiap shift kerja `.work` menghitung penghasilan bersih menggunakan rumus:

$$\text{Final Payout} = \text{round}(\text{Base Payout} \times \text{EconomyMultiplier})$$

- `EconomyMultiplier` dibaca dari record terbaru tabel `EconomyMultiplier`. Jika tidak ada data atau bernilai <= 0, default fallback adalah `1.0`.
- Format output mata uang **WAJIB** menggunakan fungsi `formatRupiah` dari `src/lib/currency.ts` (misal: `Rp250.000`).

---

## 5. Perintah Pengguna (Command Interfaces)

- **`.job` / `.job status`**: Menampilkan status pekerjaan saat ini, gaji pokok, status cooldown shift, dan panduan perintah.
- **`.job list`**: Menampilkan katalog seluruh lowongan pekerjaan, persyaratan, gaji pokok, dan durasi cooldown.
- **`.job join <ID|Nama>`**: Mendaftar atau berpindah ke pekerjaan tertentu (mendukung ID numerik seperti `.job join 1` maupun nama/alias seperti `.job join mining`).
- **`.job leave` / `.job resign`**: Mengundurkan diri dari pekerjaan aktif dan kembali berstatus belum bekerja.
- **`.work`**: Mengeksekusi shift kerja, memvalidasi cooldown, menghitung penghasilan dinamis, menambah saldo pengguna secara atomik, dan mencatat mutasi ke `ActivityLog`.

---

## 6. Standar Penomoran Versi & Rilis (Format Tanggal `G-F-P`)

> **Menggantikan** skema lama `RF-YYMM-BUILD` + SemVer. Rujuk `.agents/skills/cosmos-versioning/SKILL.md` dan `docs/VERSIONING.md` untuk spesifikasi penuh.

### 6.1 Format Tunggal — `G<generation>-F<feature>-P<patch>`

$$\mathbf{G\text{-}F\text{-}P}$$

Seluruh versi Cosmos, pra-rilis maupun stabil, **wajib** memakai format tunggal ini.

- `G`: **Generation**. Naik pada restrukturisasi besar, migrasi database mayor, penggantian framework utama, atau desain sistem yang tidak kompatibel dengan generasi sebelumnya.
- `F`: **Feature Milestone**. Naik saat sebuah fitur utama selesai dan siap dipakai.
- `P`: **Patch**. Naik untuk perbaikan bug, validasi, optimasi, perbaikan UI, dan pembaruan dokumentasi penting. Patch **reset ke `P0`** saat Feature Milestone naik.
- `.YYYY-MM-DD`: segmen tanggal rilis opsional (ISO 8601). Tidak dihitung sebagai increment.
- `-alpha|-beta|-rc1|-stable`: segmen status developmental opsional di akhir.

Contoh: `G2-F24-P7`, `G1-F12-P2.2026-09-30`, `G2-F24-P7.2026-09-30-beta`.

### 6.2 Metadata pada `version.json`

Sumber kebenaran metadata versi adalah `version.json` di root repo, dibaca lewat `src/lib/versioning.ts` (`getVersionInfo()`). Dilarang memakai `package.json` sebagai sumber versi.

```json
{
    "version": "G2-F24-P7",
    "generation": 2,
    "featureMilestone": 24,
    "patch": 7,
    "releaseDate": "2026-09-30"
}
```

Invarian: `version` wajib identik dengan `G${generation}-F${featureMilestone}-P${patch}`; komponen numerik wajib bilangan bulat non-negatif; `releaseDate` wajib ISO 8601 yang valid; `package.json` wajib sinkron.

### 6.3 Kapan Naik ke Patch / Feature / Generation

| Situasi                                             | Increment                  | Contoh                    |
| :-------------------------------------------------- | :------------------------- | :------------------------ |
| Perbaikan bug, validasi, optimasi, UI, docs penting | `patch`                    | `G2-F24-P7` → `G2-F24-P8` |
| Fitur utama selesai & siap dipakai                  | `feature` (patch reset)    | `G2-F24-P7` → `G2-F25-P0` |
| Perubahan arsitektur mayor / migrasi DB mayor       | `generation` (F & P reset) | `G2-F40-P12` → `G3-F1-P0` |

### 6.4 Otomasi Rilis

- **Manajemen metadata** — `scripts/release/version.ts`: `pnpm run version:show`, `pnpm run version:check`, `pnpm run version:bump patch|feature|generation`.
- **Publish** — `scripts/release/release.ts` (`pnpm run release:pre`): membaca `version.json`, menyelaraskan `package.json`, memvalidasi header `CHANGELOG.md`, membuat tag versi tanpa prefiks, dan memublikasi GitHub Release. Flag: `--bump <kind>`, `--stable`, `--dry-run`, `--no-push`.
- **CI** — `.github/workflows/docker-publish.yml` memicu build pada tag `G[0-9]*-F[0-9]*-P[0-9]*` dan memvalidasi `version.json`.
- Riwayat header `RF-*` di `CHANGELOG.md` tetap dipertahankan sebagai catatan siklus pra-rilis dan tidak boleh diubah.

---

## 7. Checklist Verifikasi Implementasi

Saat menambah, memodifikasi, atau memverifikasi fitur pekerjaan:

1. [ ] Jalankan `seedDefaultJobs()` saat startup atau inisialisasi agar pekerjaan awal dan item esensial tersedia.
2. [ ] Pastikan validasi `requireIdCard` dipanggil sebelum memproses lamaran atau shift kerja.
3. [ ] Pastikan pengecekan inventaris (`UserInventory`) memeriksa `ownershipStatus === 'Owned'` dan `quantity > 0` (bukan berstatus `'Pawned'` atau `'Sold'`).
4. [ ] Lindungi pembaruan saldo dan status kerja dengan `prisma.$transaction` agar tidak terjadi race condition.
5. [ ] Pastikan seluruh string respon bot didefinisikan secara simetris di `src/locales/en/tools.json` dan `src/locales/id/tools.json`.
6. [ ] Jalankan `pnpm run validate:i18n`, `pnpm exec tsx tests/job.test.ts`, `pnpm typecheck`, `pnpm lint`, dan `pnpm format`.
