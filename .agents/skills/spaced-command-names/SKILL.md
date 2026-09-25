---
name: spaced-command-names
description: >
    Standar baku penamaan perintah bot menggunakan format nama berspasi (multi-word / multi-token command names), resolusi greedy longest-prefix matching, dan registrasi alias simetris.
---

# Spaced Command Names Standards

Dokumen ini berisi standar arsitektur, pedoman penamaan, dan aturan baku implementasi perintah bot Cosmos yang mewajibkan setiap command name menggunakan spasi (multi-word / multi-token command names).

---

## 1. Latar Belakang & Motivasi

Sebelumnya, perintah bot sering kali menggunakan kata tunggal ambigu seperti `.daily`, `.loan`, `.bank`, `.buy`, atau `.profile`. Pendekatan kata tunggal memiliki beberapa kelemahan:

1. **Ambiguitas Domain & Aksi**: Perintah `.bank` atau `.loan` tanpa aksi eksplisit mengharuskan pengguna menebak sub-perintah di dalam pesan atau menerima pesan error bantuan.
2. **Tabrakan Perintah (Namespace Collisions)**: Perintah satu kata rentan berbenturan antara modul yang berbeda (misalnya `.check` vs `.check plan` vs `.check id`).
3. **Keterbacaan Percakapan Natural**: Perintah multi-kata seperti `.apply license`, `.register id`, `.daily claim`, dan `.bank deposit` lebih deskriptif, mudah dipahami pengguna, dan selaras dengan pola percakapan alami.

Oleh karena itu, seluruh command bot Cosmos **WAJIB** menggunakan nama perintah yang mengandung spasi (minimal dua kata).

---

## 2. Pola Penamaan & Konvensi Semantik

Setiap perintah wajib terdiri dari **minimal dua kata** yang dipisahkan oleh satu spasi. Penamaan harus mengikuti salah satu dari dua pola semantik berikut:

### A. Pola `<domain> <action>` (Direkomendasikan untuk modul/fitur modular)

Format ini menempatkan domain atau entitas fitur di awal, diikuti aksi yang ingin dilakukan:

- `.bank deposit <amount>` (Bukan: `.deposit` atau `.bank`)
- `.bank withdraw <amount>` (Bukan: `.withdraw`)
- `.bank statement`
- `.loan apply <amount>` (Bukan: `.loan`)
- `.loan pay <amount>`
- `.shop buy <item>` (Bukan: `.buy`)
- `.shop list`
- `.group whitelist` (Bukan: `.whitelist`)
- `.auto archive <on|off>`

### B. Pola `<action> <target/noun>` (Direkomendasikan untuk aksi spesifik)

Format ini menempatkan kata kerja aksi di awal, diikuti target atau objeknya:

- `.apply license` (Bukan: `.license` atau `.sim`)
- `.register id` (Bukan: `.idcard` atau `.ktp`)
- `.daily claim` (Bukan: `.daily`)
- `.view profile` (Bukan: `.profile`)
- `.my plan` (Bukan: `.plan`)
- `.cancel session` (Bukan: `.cancel`)
- `.sticker make` (Bukan: `.sticker` atau `.s`)

### Contoh Salah vs Contoh Benar

| Contoh Salah (Single-Word) | Contoh Benar (Spaced Command Name) | Penjelasan                          |
| :------------------------- | :--------------------------------- | :---------------------------------- |
| `name: 'daily'`            | `name: 'daily claim'`              | Mengandung spasi dan aksi eksplisit |
| `name: 'buy'`              | `name: 'shop buy'`                 | Menempatkan domain dan aksi jelas   |
| `name: 'ktp'`              | `name: 'register id'`              | Multi-kata standar formal           |
| `name: 'sim'`              | `name: 'apply license'`            | Multi-kata deskriptif               |
| `name: 'fever'`            | `name: 'fever time'`               | Memisahkan frasa dengan spasi       |
| `name: 'top'`              | `name: 'top global'`               | Multi-kata deskriptif               |

---

## 3. Aturan Deklarasi `ToolDefinition` & Aliases

### A. Deklarasi `name` dan `displayNames`

Field `name` pada `ToolDefinition` **WAJIB** berupa string yang memuat spasi:

```typescript
export const definition: ToolDefinition = {
    name: 'daily claim',
    title: 'Daily Coin Reward',
    displayNames: {
        en: 'daily claim',
        id: 'klaim harian'
    },
    category: 'Economy',
    aliases: ['daily claim', '.daily claim', 'klaim harian', '.klaim harian', 'claim daily', '.claim daily'],
    description: 'Claim your free daily coin allowance from the vault.',
    descriptionKey: 'tools.commands.daily_claim.description'
};
```

### B. Aturan Aliases

1. **Wajib Memiliki Alias Spasi Sesuai Bahasa:** Sertakan alias multi-kata dalam bahasa Inggris dan padanannya dalam bahasa Indonesia (`displayNames.en` dan `displayNames.id`).
2. **Toleransi Prefix Titik:** Daftarkan alias baik yang diawali titik (`.daily claim`) maupun tanpa titik (`daily claim`) untuk kompatibilitas pencarian langsung.
3. **Pembersihan Hyphen/Underscore:** Meskipun `ToolsHandler.getTool()` secara otomatis menormalisasi tanda hubung (`-`) dan garis bawah (`_`) menjadi spasi, definisi utama `name` tetap harus menggunakan spasi harfiah.

### C. Konvensi `descriptionKey` (i18n)

Spasi pada `name` dikonversi menjadi garis bawah (`_`) saat membentuk kunci i18n:

- Nama: `'daily claim'` $\rightarrow$ `descriptionKey: 'tools.commands.daily_claim.description'`
- Nama: `'apply license'` $\rightarrow$ `descriptionKey: 'tools.commands.apply_license.description'`
- Nama: `'bank deposit'` $\rightarrow$ `descriptionKey: 'tools.commands.bank_deposit.description'`

---

## 4. Resolusi Parser Pesan & Ekstraksi Argumen

### A. Algoritma Greedy Longest-Prefix Matching

Handler pemrosesan pesan (`message.ts`) wajib menyelesaikan nama perintah menggunakan pencocokan prefix terpanjang (_greedy longest-prefix matching_):

1. Pesan pengguna dipotong (_trimmed_) dan dipecah menjadi token berdasarkan spasi.
2. Parser memeriksa kandidat gabungan token dari jumlah kata terbanyak ke yang paling sedikit (misal: 4 kata $\rightarrow$ 3 kata $\rightarrow$ 2 kata $\rightarrow$ 1 kata) terhadap `toolsHandler.getTool(candidate)`.
3. Token yang cocok pertama kali ditetapkan sebagai `commandName`.
4. Seluruh sisa karakter setelah nama perintah yang cocok diekstrak sebagai `argsStr`:
    ```typescript
    argsStr = trimmedText.substring(matchedCommandLength).trim();
    ```

### B. Larangan Pemotongan Token Kaku (Hardcoded Token Slicing)

Di dalam fungsi `execute(args, ctx)` setiap tool:

- **DILARANG** melakukan parsing mentah dengan mengasumsikan indeks posisi kata kaku, seperti:
    ```typescript
    // SALAH: Mengasumsikan perintah selalu 1 kata sehingga kata ke-2 adalah argumen
    const parts = rawText.split(/\s+/);
    const subCommand = parts[1]; // AKAN RUSAK jika command name terdiri dari 2 kata!
    ```
- **WAJIB** membaca argumen dari objek `args` yang sudah disediakan oleh dispatcher, atau memproses string sisa (`argsStr`) setelah nama perintah.

---

## 5. Standar Tampilan Menu, Help, dan Dokumentasi

1. **Format Prefix Titik:** Setiap kali menuliskan contoh pemanggilan perintah dalam string respon bot, kartu menu (`.menu`), atau panduan bantuan (`.help`), **WAJIB** menggunakan prefix titik disusul nama berspasi lengkap:
    - Contoh: `.daily claim`
    - Contoh: `.bank deposit 100.000`
    - Contoh: `.shop buy gorengan 5`
2. **Dilarang Menampilkan Sintaks Satu Kata:** Jangan menampilkan perintah satu kata usang (`.daily`, `.bank`) pada daftar menu atau footer tips interaktif.
