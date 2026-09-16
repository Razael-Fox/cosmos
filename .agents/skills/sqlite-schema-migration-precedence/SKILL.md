---
name: sqlite-schema-migration-precedence
description: >
    Panduan baku urutan eksekusi migrasi programmatic DDL SQLite (ensureDatabaseSchema) pada Cosmos, mencegah fatal error 'no such column' pada CREATE INDEX saat migrasi database yang sudah ada (legacy SQLite).
---

# Cosmos SQLite Schema Migration Precedence Standards

Dokumen ini adalah panduan teknis untuk mengelola migrasi skema basis data SQLite secara terprogram (`ensureDatabaseSchema`) menggunakan driver native `better-sqlite3` pada engine Bot Cosmos dan Fastify API Gateway.

---

## 1. Latar Belakang Masalah (The Trap)

Cosmos menggunakan migrasi DDL terprogram berbasis `better-sqlite3` (tanpa CLI Prisma Migrate) agar dapat berjalan mulus di lingkungan terbatas seperti Android Termux, Docker unprivileged container, dan VPS mikro.

Pada eksekusi multi-statement SQL (`db.exec(...)`):

```sql
CREATE TABLE IF NOT EXISTS "OtpVerification" ( ... );
CREATE INDEX IF NOT EXISTS "OtpVerification_lookupHash_idx" ON "OtpVerification"("lookupHash");
```

Jika file basis data SQLite **sudah ada sebelumnya** (database lama):

1. Perintah `CREATE TABLE IF NOT EXISTS` tidak dieksekusi karena tabel sudah ada, namun tabel lama tersebut **belum memiliki** kolom baru (`lookupHash`).
2. SQLite langsung mengeksekusi `CREATE INDEX IF NOT EXISTS ... ("lookupHash")`.
3. SQLite melempar error fatal:
    ```
    SqliteError: no such column: "lookupHash" - should this be a string literal in single-quotes?
    ```
4. Seluruh sisa skrip SQL dalam blok `db.exec(...)` langsung **terhenti**.
5. Fungsi migrasi kolom tambahan (`ensureColumnExists(...)`) yang ditaruh di bawah blok SQL utama **tidak akan pernah dieksekusi**.
6. Akibatnya, pemanggilan Prisma Client runtime melempar error:
    ```
    Invalid `prisma.otpVerification.create()` invocation: The column `lookupHash` does not exist in the current database
    ```

---

## 2. Aturan Baku Presedensi Migrasi (Execution Order)

Setiap kali menambahkan kolom baru beserta indeksnya pada model basis data yang sudah ada, AI Agent **WAJIB** mematuhi 3 tahap eksekusi berurutan:

### Tahap 1: Base Tables & Primary Indexes Only

Di dalam blok multi-statement utama `db.exec(...)`, HANYA deklarasikan indeks untuk kolom yang pasti ada sejak tabel pertama kali dibuat:

```sql
CREATE TABLE IF NOT EXISTS "OtpVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneNumber" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "lookupHash" TEXT,
    ...
);
CREATE UNIQUE INDEX IF NOT EXISTS "OtpVerification_regSessionId_key" ON "OtpVerification"("regSessionId");
CREATE INDEX IF NOT EXISTS "OtpVerification_phone_purpose_used_idx" ON "OtpVerification"("phoneNumber", "purpose", "isUsed");
-- ⚠️ JANGAN buat indeks untuk kolom migrasi bertahap (seperti lookupHash) di sini!
```

### Tahap 2: Ensure Column Exists

Pastikan kolom baru ditambahkan ke tabel yang sudah ada terlebih dahulu melalui fungsi helper `ensureColumnExists`:

```typescript
function ensureColumnExists(db: Database.Database, table: string, column: string, definition: string): void {
    try {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === column)) {
            db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
        }
    } catch {
        /* ignore migration error */
    }
}

// Eksekusi penambahan kolom:
ensureColumnExists(db, 'OtpVerification', 'lookupHash', 'TEXT');
```

### Tahap 3: Safe Index Creation in Isolated Try/Catch

Setelah kolom dijamin ada, buat indeks baru di dalam blok `try/catch` mandiri:

```typescript
ensureColumnExists(db, 'OtpVerification', 'lookupHash', 'TEXT');
try {
    db.exec(`CREATE INDEX IF NOT EXISTS "OtpVerification_lookupHash_idx" ON "OtpVerification"("lookupHash")`);
} catch (err) {
    console.warn('[DB] Failed to create index OtpVerification_lookupHash_idx:', err);
}
```

---

## 3. Sinkronisasi Antar-Layanan (Dual-Maintenance)

Skema basis data Cosmos dikonsumsi oleh dua layanan terpisah:

1. **Bot Engine**: `src/db.ts`
2. **API Gateway**: `.worktrees/api/src/db.ts`

Setiap perubahan kolom baru, tipe data, atau indeks pada DDL SQLite **WAJIB** diperbarui secara simetris di kedua file tersebut agar tidak terjadi inkonsistensi skema saat salah satu layanan melakukan bootstrap pada database bersama.
