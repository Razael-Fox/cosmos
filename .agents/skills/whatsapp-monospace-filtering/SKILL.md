---
name: whatsapp-monospace-filtering
description: >
    Standar baku penanganan sistem monospace WhatsApp (triple backtick ``` dan inline backtick `) serta kutipan string (" dan ') untuk ekstraksi parameter command yang mengandung spasi atau mencegah bentrok kata kunci.
---

# WhatsApp Monospace Filtering Standards

Dokumen ini berisi standar implementasi dan pedoman baku untuk mengekstrak string parameter dari pesan pengguna menggunakan fitur format monospace bawaan WhatsApp.

---

## 1. Latar Belakang & Konteks

WhatsApp memiliki dukungan pemformatan teks monospace bawaan menggunakan:

- Tiga backtick: ` ```teks di sini``` `
- Satu inline backtick: `` `teks di sini` ``

Pengguna sering menggunakan format monospace ini (atau tanda kutip ganda `"` / tanda kutip tunggal `'`) untuk:

1. **Mengelompokkan argumen berisiko spasi**: Misalnya pada perintah `.contact add `Ls Friends` 123456789`, di mana alias terdiri dari dua kata atau lebih yang dipisahkan spasi sebelum nomor telepon.
2. **Disambiguasi kata kunci harfiah**: Misalnya pada `.brat ```animasi keren``` `, di mana pengguna ingin membuat stiker teks bertuliskan "animasi keren" secara statis tanpa memicu sub-command animasi `.brat animasi`.

---

## 2. Utility Global (`src/utils/monospace.ts`)

Seluruh parsing parameter yang membutuhkan ekstraksi string berformat monospace atau bertanda kutip **WAJIB** menggunakan utility terpusat dari `src/utils/monospace.ts`:

- `extractLeadingMonospace(input: string)`:
  Mengekstrak blok monospace/kutipan terdepan dari teks parameter dan mengembalikan sisa parameter yang belum diproses.

    ```typescript
    import { extractLeadingMonospace } from '#utils/monospace.js';

    const { matched, extracted, remainder } = extractLeadingMonospace('`Ls Friends` 08123456789');
    // matched: true
    // extracted: 'Ls Friends'
    // remainder: '08123456789'
    ```

- `unwrapMonospace(input: string)`:
  Membuka pembungkus monospace (`...` atau `...`) atau kutipan ("...", '...') jika seluruh teks terbungkus.

    ````typescript
    import { unwrapMonospace } from '#utils/monospace.js';

    const { text, wasWrapped } = unwrapMonospace('```animasi keren```');
    // text: 'animasi keren'
    // wasWrapped: true
    ````

- `isMonospaceWrapped(input: string)`:
  Memeriksa apakah string dimulai dan diakhiri oleh backtick monospace WhatsApp.

---

## 3. Aturan Baku Penggunaan

1. **Dilarang Menulis Regex Monospace Terpisah-pisah**:
   Jangan menduplikasi regex `match(/^(?:```([\s\S]+?)```|`([^`]+)`...)/)`secara manual di berbagai tools. Gunakan fungsi dari`src/utils/monospace.ts`.
2. **Prioritas Ekstraksi**:
   Urutan presedensi ekstraksi adalah:
    - Triple backtick (`...`)
    - Single backtick (`...`)
    - Double quotes ("...")
    - Single quotes ('...')
3. **Disambiguasi Intent Harfiah**:
   Jika sebuah tool memiliki parameter kata kunci otomatis (seperti `animasi` pada `.brat`), kehadiran pembungkus monospace atau kutipan menandakan bahwa pengguna menghendaki teks tersebut secara harfiah (_literal text_), sehingga deteksi kata kunci otomatis harus dilewati (_bypass_).
