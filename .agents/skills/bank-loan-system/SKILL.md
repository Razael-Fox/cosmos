---
name: bank-loan-system
description: >
    Panduan baku arsitektur dan implementasi Subsistem Pinjaman Bank (Bank Loan System) Cosmos, mencakup penilaian risiko kredit AI (Groq), manajemen skor kredit & reputasi, pencegahan race condition, agunan, pembekuan rekening, dan penyitaan aset otomatis.
---

# Cosmos Bank Loan System (BLS) Standards

## 1. Ringkasan & Konteks

Subsistem Pinjaman Bank (**Bank Loan System / BLS**) adalah fasilitas peminjaman dana berbasis penilaian risiko kredit AI pada Cosmos WhatsApp Bot framework (`src/services/loanService.ts` dan `src/commands/economy-banking/loan.ts`). Subsistem ini terintegrasi erat dengan Cosmos Central Bank (CCB), KTP Virtual ID (`IdCard`), katalog properti real estat (`PropertyCatalog`), serta sistem inventaris (`UserInventory`).

Fitur utama meliputi:

1. Penilaian underwriting otomatis via Groq LLM (Native Function Calling).
2. Skor kredit dinamis (0–1000) dan tingkatan reputasi (`Poor`, `Fair`, `Good`, `Excellent`).
3. Pencairan dana atomik langsung ke rekening bank (`BankAccount`).
4. Alur konfirmasi interaktif 3 menit terintegrasi dengan pembatalan global (`.cancel`).
5. Proteksi mutlak terhadap _race conditions_ pada level in-flight async & transaksi ACID database.
6. Pengingat otomatis 5 hari sebelum jatuh tempo.
7. Pembekuan rekening bank (`status = 'FROZEN'`) dan penyitaan aset inventaris/properti jika terjadi gagal bayar (_default_).

---

## 2. Arsitektur Model Database (`prisma/schema.prisma`)

```prisma
model Loan {
    id              String         @id @default(uuid())
    userId          String
    principalAmount BigInt         // Nilai pokok pinjaman
    interestRate    Float          // Bunga hasil underwriting AI (contoh: 0.05 untuk 5%)
    dueDate         DateTime       // Tenggat waktu pelunasan
    status          String         @default("ACTIVE") // ACTIVE, PAID, DEFAULTED
    collateralItems String?        // JSON string aset yang diagunkan
    createdAt       DateTime       @default(now())
    updatedAt       DateTime       @updatedAt

    user            User           @relation(fields: [userId], references: [id], onDelete: Cascade)
    reminders       LoanReminder[]

    @@index([userId])
    @@index([status])
}

model ActivityLog {
    id          String   @id @default(uuid())
    userId      String
    type        String   // LOAN_DISBURSEMENT, LOAN_REPAYMENT, LOAN_DEFAULT, CASINO_LOSS, CASINO_WIN, REAL_ESTATE_PURCHASE
    amount      BigInt?  // Nominal aktivitas
    description String?
    createdAt   DateTime @default(now())

    user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@index([userId])
    @@index([type])
    @@index([createdAt])
}

model LoanReminder {
    id        String   @id @default(uuid())
    loanId    String
    userJid   String
    chatJid   String?
    remindAt  DateTime // Tanggal pengingat (H-5 sebelum dueDate)
    sent      Boolean  @default(false)
    createdAt DateTime @default(now())

    loan      Loan     @relation(fields: [loanId], references: [id], onDelete: Cascade)

    @@index([loanId])
    @@index([remindAt, sent])
}
```

---

## 3. Tingkatan Reputasi & Batas Pinjaman

Skor kredit dikalkulasi dalam fungsi `evaluateCreditScore(userId)` dan dibatasi ketat antara **0 hingga 1000** (default akun baru: 500):

| Tingkat Reputasi | Rentang Skor | Maks. Limit Pinjaman | Suku Bunga AI | Tenor Pinjaman |
| :--------------- | :----------- | :------------------- | :------------ | :------------- |
| **Poor**         | `< 450`      | `Rp0` (Ditolak)      | -             | -              |
| **Fair**         | `450 - 599`  | `Rp15.000.000`       | 8% - 12%      | 7 - 14 Hari    |
| **Good**         | `600 - 749`  | `Rp50.000.000`       | 5% - 8%       | 14 - 21 Hari   |
| **Excellent**    | `750 - 1000` | `Rp100.000.000`      | 2% - 5%       | 21 - 30 Hari   |

### Aturan Perhitungan Skor Kredit (`ActivityLog` 30 Hari Terakhir):

- Pelunasan pinjaman tepat waktu (`LOAN_REPAYMENT`): **+15 poin**
- Gagal bayar pinjaman (`LOAN_DEFAULT`): **-75 poin**
- Pembelian real estat (`REAL_ESTATE_PURCHASE`): **+20 poin**
- Kemenangan kasino besar (`CASINO_WIN > Rp10.000.000`): **+5 poin**
- Kekalahan kasino besar (`CASINO_LOSS > Rp10.000.000`): **-5 poin**
- Bonus kekayaan bersih (_Net Worth_): `> Rp100.000.000` (+30 poin), `> Rp25.000.000` (+15 poin).

---

## 4. Pencegahan Race Condition & Konkurensi Mutlak

Untuk mencegah eksploitasi ganda (seperti peminjaman atau pelunasan simultan dari pesan berulang), sistem **WAJIB** menerapkan 3 lapisan pengamanan:

### A. In-Flight Mutex di Level Memori

Gunakan `Set<string>` untuk mengunci proses yang sedang berjalan per pengguna:

```typescript
const activeAssessments = new Set<string>();
const activeDisbursements = new Set<string>();
const activeRepayments = new Set<string>();
```

Setiap operasi asinkron (misal: pemanggilan Groq API pada `.loan apply`) wajib didaftarkan ke Set dan dibersihkan di blok `finally`.

### B. Validasi Ulang di Dalam `prisma.$transaction`

Pemeriksaan ketiadaan pinjaman aktif **DILARANG HANYA DI LUAR TRANSAKSI**. Validasi wajib dieksekusi di dalam blok `$transaction`:

```typescript
await prisma.$transaction(async (tx) => {
    const existingActiveLoan = await tx.loan.findFirst({
        where: { userId, status: 'ACTIVE' }
    });
    if (existingActiveLoan) {
        throw new Error('User already has an active loan in progress.');
    }
    // Lanjutkan pembuatan pinjaman dan mutasi saldo
});
```

### C. Konsumsi Sesi Instan

Saat menerima pesan `confirm`, sesi pinjaman tertunda (`pendingLoans`) harus dihapus **sebelum** promise disbursement diselesaikan untuk mencegah re-entrancy.

---

## 5. Penyitaan Aset (Asset Seizure) & Pembekuan Rekening

Jika pinjaman melewati tanggal `dueDate` dan belum lunas:

1. **Pembekuan Rekening:** Rekening bank pengguna diubah statusnya menjadi `'FROZEN'`. Seluruh transfer keluar, penarikan tunai, dan pinjaman baru diblokir.
2. **Algoritma Likuidasi Selektif (`seizeUserAssetsForDebt`):**
    - Mengambil seluruh aset `UserInventory` milik pengguna dengan `ownershipStatus: 'Owned'`.
    - Mengurutkan aset dari nilai Rupiah tertinggi ke terendah (_highest value first_).
    - Mengubah `ownershipStatus` aset yang disita menjadi `'Pawned'`.
    - Aset yang berstatus `'Pawned'` otomatis tersembunyi dari `.inventory` dan tidak dapat dijual via `.sell`.
    - Nilai aset mengurangi sisa hutang hingga lunas atau inventaris habis.
3. **Pencabutan Pembekuan:** Jika sisa hutang berhasil tertutup penuh (`debtRemaining <= 0`), status pinjaman diubah menjadi `'DEFAULTED'` dan rekening bank dipulihkan ke status `'ACTIVE'`.
4. **Notifikasi Sita:** Sistem mengirimkan rincian aset yang disita beserta nominalnya ke nomor WhatsApp peminjam.

---

## 6. Standar Notifikasi, Bahasa, dan Format Rupiah

1. **Formal English Output:** Seluruh respon bot, pesan penolakan, pengingat jatuh tempo, dan rincian penyitaan wajib menggunakan Bahasa Inggris Formal melalui file lokalisasi `src/locales/en/tools.json` dan `src/locales/id/tools.json` pada namespace `tools.loan.*`.
2. **Format Rupiah Baku:** Semua angka nominal mata uang wajib diformat menggunakan fungsi global `formatRupiah` dari `src/lib/currency.ts` (contoh: `Rp25.000.000`).
3. **Pembatalan Global:** Sesi interaktif pengajuan pinjaman wajib didaftarkan ke `cancellationManager` dan dapat dibatalkan sewaktu-waktu menggunakan perintah `.cancel`, `cancel`, atau `batal`.

---

## 7. Checklist Pengujian & Verifikasi

Sebelum mengklaim perubahan subsistem pinjaman selesai:

1. `pnpm typecheck` bebas dari error tipe.
2. `pnpm lint` bebas dari error dan peringatan linting.
3. `pnpm format` telah dijalankan untuk merapikan seluruh berkas.
4. `pnpm tsx tests/loan.test.ts` berhasil mengeksekusi seluruh skenario (10/10 pass).
5. `pnpm tsx tests/bank.test.ts` berhasil memastikan tidak ada regresi pada CCB core (9/9 pass).
6. Melakukan commit lokal (`git commit`) dengan pesan semantik yang jelas.
