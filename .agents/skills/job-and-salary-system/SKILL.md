---
name: job-and-salary-system
description: >
    Panduan baku arsitektur dan implementasi Subsistem Pekerjaan dan Gaji (Job & Salary System) Cosmos, mencakup katalog profesi, persyaratan ID Card & item/lisensi, perhitungan gaji dinamis berbasis EconomyMultiplier makroekonomi, pelacakan cooldown shift, serta standar versi rilis (pre-release RF-YYMM-BUILD dan rilis stabil SemVer).
---

# Cosmos Job & Salary System Standards

## 1. Ringkasan & Konteks

Subsistem Pekerjaan dan Gaji (**Job & Salary System**) adalah fitur perkembangan ekonomi non-perjudian pada Cosmos WhatsApp Bot framework (`src/services/jobs.ts`, `src/tools/job.ts`, `src/tools/work.ts`). Sistem ini memberikan alternatif bagi pengguna untuk mendapatkan saldo (`balance`) secara konsisten melalui shift kerja dan dividen usaha yang nilainya berfluktuasi mengikuti kondisi makroekonomi riil.

Fitur utama meliputi:

1. **Katalog Karier Terstruktur**: Mendukung berbagai jalur profesi dengan siklus pembayaran, risiko, dan variasi pendapatan berbeda (Mining, Office Work, Taxi Driving, Cooking, Gojek, Entrepreneurship).
2. **Kompensasi Dinamis Berbasis Inflasi**: Gaji pokok dikalikan dengan `EconomyMultiplier` dari tabel database yang diperbarui secara otomatis oleh AI berdasarkan kurs valuta asing USD/IDR dari API EODHD.
3. **Gerbang Wajib KTP (Virtual ID Card Gate)**: Memeriksa kepemilikan KTP (`requireIdCard`). Pengguna tanpa KTP dilarang melamar pekerjaan atau bekerja.
4. **Persyaratan Inventaris & Lisensi**: Validasi kepemilikan alat pendukung (Pickaxe, MacBook, iPhone, SIM / Driver's License) sebelum lamaran diterima atau shift dieksekusi.
5. **Pelacakan Cooldown Shift Atomik**: Menggunakan field `lastWorkedAt` dan `cooldownMinutes` untuk mencegah spam perintah `.work`.
6. **Pencatatan Audit Ledger**: Setiap pendapatan gaji dicatat ke model `ActivityLog` (`type: 'JOB_SALARY'`).
7. **Standar Penomoran Versi & Rilis `RF-YYMM-BUILD`**: Format penomoran versi rilis framework menggunakan skema `RF-YYMM-BUILD` melalui otomasi `scripts/release.ts`.

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
- Format output mata uang **WAJIB** menggunakan fungsi `formatRupiah` dari `src/utils/currency.ts` (misal: `Rp250.000`).

---

## 5. Perintah Pengguna (Command Interfaces)

- **`.job` / `.job status`**: Menampilkan status pekerjaan saat ini, gaji pokok, status cooldown shift, dan panduan perintah.
- **`.job list`**: Menampilkan katalog seluruh lowongan pekerjaan, persyaratan, gaji pokok, dan durasi cooldown.
- **`.job join <ID|Nama>`**: Mendaftar atau berpindah ke pekerjaan tertentu (mendukung ID numerik seperti `.job join 1` maupun nama/alias seperti `.job join mining`).
- **`.job leave` / `.job resign`**: Mengundurkan diri dari pekerjaan aktif dan kembali berstatus belum bekerja.
- **`.work`**: Mengeksekusi shift kerja, memvalidasi cooldown, menghitung penghasilan dinamis, menambah saldo pengguna secara atomik, dan mencatat mutasi ke `ActivityLog`.

---

## 6. Standar Penomoran Versi & Rilis (Pre-Release `RF-YYMM-BUILD` & Rilis Stabil SemVer)

Cosmos memisahkan penomoran versi berdasarkan jenis rilisnya.

### 6.1 Pre-Release — Skema `RF-YYMM-BUILD` (Khusus Pra-Rilis)

$$\mathbf{RF\text{-}YYMM\text{-}BUILD}$$

- `RF`: Prefix tetap (Release Format).
- `YY`: 2 digit tahun (contoh: `26` untuk 2026).
- `MM`: 2 digit bulan (contoh: `09` untuk September).
- `BUILD`: Nomor build rilis 2 digit berurutan pada bulan tersebut (contoh: `01`, `02`, `03`).
- Skema ini **khusus** untuk siklus pra-rilis dan **dilarang** dipakai pada rilis stabil.

### 6.2 Rilis Stabil — Standar SemVer

- Rilis stabil **wajib** mengikuti standar **SemVer**: `MAJOR.MINOR.PATCH` (contoh: `1.0.0`).
- Field `"version"` di `package.json` memakai SemVer **tanpa prefiks** (`1.0.0`).
- Tag Git dan GitHub Release untuk rilis stabil memakai prefiks `v` (`v1.0.0`).
- Rilis stabil **dilarang** menggunakan format `RF-YYMM-BUILD`.
- Saat transisi ke rilis stabil, riwayat header `RF-*` di `CHANGELOG.md` tetap dipertahankan sebagai catatan siklus pra-rilis.

### 6.3 Otomasi Rilis

- **Pre-Release** — Script: `scripts/release.ts` (dijalankan melalui `pnpm run release:pre`).
    - Secara otomatis memperbarui `"version"` di `package.json`, mencocokkan header rilis di `CHANGELOG.md`, membuat tag pre-release, melakukan push ke branch aktif, dan mempublikasikan pre-release di GitHub via `gh release create --prerelease`.
- **Rilis Stabil** — belum memiliki script otomasi; **wajib** dilakukan secara eksplisit dan terverifikasi (tag `v<semver>`, GitHub Release **tanpa** flag `--prerelease`).

---

## 7. Checklist Verifikasi Implementasi

Saat menambah, memodifikasi, atau memverifikasi fitur pekerjaan:

1. [ ] Jalankan `seedDefaultJobs()` saat startup atau inisialisasi agar pekerjaan awal dan item esensial tersedia.
2. [ ] Pastikan validasi `requireIdCard` dipanggil sebelum memproses lamaran atau shift kerja.
3. [ ] Pastikan pengecekan inventaris (`UserInventory`) memeriksa `ownershipStatus === 'Owned'` dan `quantity > 0` (bukan berstatus `'Pawned'` atau `'Sold'`).
4. [ ] Lindungi pembaruan saldo dan status kerja dengan `prisma.$transaction` agar tidak terjadi race condition.
5. [ ] Pastikan seluruh string respon bot didefinisikan secara simetris di `src/locales/en/tools.json` dan `src/locales/id/tools.json`.
6. [ ] Jalankan `pnpm run validate:i18n`, `pnpm exec tsx tests/job.test.ts`, `pnpm typecheck`, `pnpm lint`, dan `pnpm format`.
