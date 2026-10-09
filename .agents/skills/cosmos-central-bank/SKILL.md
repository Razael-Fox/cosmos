---
name: cosmos-central-bank
description: >
    Panduan baku arsitektur dan implementasi Cosmos Central Bank (CCB), mencakup pembukuan double-entry ACID, KTP registration gate, transfer interaktif dengan pembatalan global, limit harian, bunga majemuk, dan notifikasi multibahasa.
---

# Cosmos Central Bank (CCB) Subsystem Standards

## 1. Ringkasan & Konteks

Cosmos Central Bank (CCB) adalah subsistem perbankan terdesentralisasi virtual pada Cosmos WhatsApp Bot framework (`src/services/bankService.ts` dan `src/commands/economy-banking/bank.ts`). Subsistem ini mengelola rekening pengguna (`BankAccount`), transaksi pembukuan ganda (_double-entry ledger_) yang tidak dapat diubah (`BankTransaction`), limit transfer harian, bunga majemuk harian, serta konfirmasi transfer interaktif yang terhubung ke sistem pembatalan global.

Semua implementasi modul perbankan atau fitur ekonomi baru yang berinteraksi dengan saldo bank wajib mengikuti pedoman teknis di dokumen ini.

---

## 2. Arsitektur Database & Double-Entry Ledger (ACID)

### Model Prisma (`prisma/schema.prisma`)

```prisma
model BankAccount {
    id                  String            @id @default(uuid())
    accountNumber       String            @unique // Format: CCB-XXXXXX (6 digit angka acak)
    userJid             String            @unique
    balance             Int               @default(0)
    tier                String            @default("STANDARD") // STANDARD, GOLD, PLATINUM
    dailyTransferAmount Int               @default(0)
    lastTransferDate    DateTime?
    createdAt           DateTime          @default(now())
    updatedAt           DateTime          @updatedAt
    transactions        BankTransaction[]

    @@index([userJid])
    @@index([accountNumber])
}

model BankTransaction {
    id            String      @id @default(uuid())
    accountId     String
    account       BankAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
    type          String      // DEPOSIT, WITHDRAW, TRANSFER_IN, TRANSFER_OUT, INTEREST, REGISTRATION_FEE
    amount        Int
    balanceAfter  Int
    description   String
    referenceId   String?     // UUID referensi silang antar rekening untuk transfer
    createdAt     DateTime    @default(now())

    @@index([accountId])
    @@index([createdAt])
    @@index([referenceId])
}
```

### Prinsip Transaksi ACID

1. **Prisma `$transaction` Exclusivity:** Semua mutasi saldo (deposit, penarikan, transfer, biaya pendaftaran, dan bunga) **WAJIB** dieksekusi di dalam `prisma.$transaction`. Dilarang melakukan update saldo secara terpisah dari pembuatan record `BankTransaction`.
2. **Immutable Audit Trail:** Setiap baris `BankTransaction` mencatat `balanceAfter` yang akurat secara real-time. Record transaksi dilarang di-edit atau dihapus secara mutasi biasa.
3. **Cross-Reference ID:** Pada transaksi transfer dua arah (`TRANSFER_OUT` untuk pengirim dan `TRANSFER_IN` untuk penerima), wajib dicantumkan `referenceId` yang sama (UUID) pada kedua mutasi untuk kemudahan audit trail.

---

## 3. Ketentuan & Kebijakan Bisnis (Business Rules)

| Parameter                     | Nilai Default                        | Keterangan                                                                     |
| :---------------------------- | :----------------------------------- | :----------------------------------------------------------------------------- |
| **Prasyarat Registrasi**      | Memiliki KTP (`isRegistered = true`) | Pengguna wajib terdaftar di Virtual ID Card (`src/services/ktpService.ts`).    |
| **Biaya Registrasi Rekening** | `Rp50.000`                           | Dipotong dari saldo dompet (`User.balance`) saat `.bank register`.             |
| **Minimum Deposit**           | `Rp10.000`                           | Dipotong dari dompet tunai dan dimasukkan ke rekening bank.                    |
| **Minimum Penarikan**         | `Rp10.000`                           | Dipotong dari rekening bank dan dicairkan ke dompet tunai.                     |
| **Minimum Transfer**          | `Rp10.000`                           | Nilai minimum per transaksi transfer antar rekening.                           |
| **Batas Transfer Harian**     | `Rp50.000.000`                       | Direset otomatis jika tanggal hari ini berbeda dengan `lastTransferDate`.      |
| **Bunga Majemuk Harian**      | `0.1%` per hari                      | Dihitung dari saldo minimum `Rp100.000`, dibagikan secara batch setiap 24 jam. |

---

## 4. Alur Konfirmasi Interaktif & Integrasi Pembatalan Global

### Transfer Interaktif Dua Langkah (`.bank transfer`)

1. Saat pengguna memicu perintah `.bank transfer <targetAcc> <amount>`, sistem **tidak langsung mengeksekusi transfer**.
2. Sistem memvalidasi saldo, kepemilikan rekening tujuan, limit harian, dan self-transfer (dilarang transfer ke rekening sendiri).
3. Jika valid, sistem mendaftarkan sesi konfirmasi interaktif ke memori:
    - Sesi berlaku selama 3 menit.
    - Sesi didaftarkan ke `cancellationManager` menggunakan `registerCancellableSession`.
    - Pengguna diminta membalas dengan mengetik `confirm` untuk melanjutkan, atau `.cancel` / `cancel` / `batal` untuk membatalkan.
4. Jika pengguna mengetik `confirm`:
    - Validasi saldo dan limit diulang secara atomik dalam `$transaction`.
    - Transfer dieksekusi.
    - Sesi di-unregister dari `cancellationManager`.
    - Pengirim menerima struk transfer, dan penerima menerima notifikasi pesan (push notification).
5. Jika pengguna membatalkan via `.cancel`:
    - Callback `onCancel` membersihkan timer dan data sesi.
    - Mengembalikan respon konfirmasi pembatalan tanpa mutasi dana.

---

## 5. Standar Notifikasi & Kompatibilitas JID/LID/i18n

### Resolusi Bahasa Penerima (Recipient Dynamic Language Resolution)

Saat mengirimkan notifikasi transfer masuk ke penerima, **JANGAN** menggunakan instance translator `ctx.t` milik pengirim. Selalu resolusi preferensi bahasa obrolan/user penerima:

```typescript
import { getChatLanguage, getFixedT } from '../locales/i18n.config.js';

const targetLang = await getChatLanguage(targetUserJid);
const targetT = getFixedT(targetLang);

const receiverMsg = targetT('tools:bank.messages.transfer_received', {
    amount: formatRupiah(amount),
    senderName: senderAccount.userJid.split('@')[0],
    senderAcc: senderAccount.accountNumber,
    newBalance: formatRupiah(receiverAccount.balance + amount)
});
```

### Green Mentions & JID/LID Formatting

- Saat mengisi array `mentions` pada pesan Baileys, gunakan utility `formatMentions`:
    ```typescript
    import { formatMentions } from '../lib/casino.js';
    const mentions = formatMentions([targetUserJid]);
    ```
- Dukung pencarian user baik via format nomor telepon murni (`628xxx`), JID (`...@s.whatsapp.net`), maupun LID (`...@lid`).

---

## 6. Format Mata Uang & Standar Output

- **Format Rupiah:** Selalu gunakan `formatRupiah` dari `src/lib/currency.ts` untuk menampilkan saldo, limit, atau nominal uang (`Rp10.000`, `Rp50.000.000`).
- **Parsing Nominal:** Selalu gunakan `parseCurrencyAmount` dari `src/lib/currency.ts` untuk menangani format teks fleksibel dari pengguna (`10k`, `1jt`, `10.000`).
- **Pesan Formal English / i18n:** Seluruh output teks harus melalui namespace `tools:bank.*` pada file JSON lokalisasi (`src/locales/en/tools.json` dan `src/locales/id/tools.json`).

---

## 7. Checklist Verifikasi Developer / Agent

Sebelum mengklaim perubahan subsistem bank selesai, pastikan:

1. `pnpm typecheck` bebas dari error tipe.
2. `pnpm lint` bebas dari peringatan / error linting ESLint.
3. `pnpm format` telah dijalankan (`prettier --write`).
4. `pnpm tsx tests/bank.test.ts` berhasil mengeksekusi seluruh pengujian skenario perbankan (9/9 pass).
5. Perubahan di-commit secara lokal menggunakan `git commit` dengan pesan semantik yang jelas.
