---
name: i18n-localization-standards
description: >
    Panduan baku implementasi sistem internasionalisasi (i18n) di Cosmos, mencakup struktur locales, build asset copying, deteksi missing key dengan i18n.exists(), resolusi bahasa JID/LID, dan integrasi ToolExecutionContext.
---

# Cosmos Internationalization (i18n) Standards

Dokumen ini adalah panduan teknis dan standar baku untuk implementasi sistem multibahasa (internasionalisasi) pada Cosmos WhatsApp Bot Framework.

---

## 1. Ringkasan Arsitektur

Cosmos menggunakan **`i18next`** sebagai mesin translasi utama dengan struktur modular:

- **Bahasa yang Didukung**:
    - `id` (Indonesian / Bahasa Indonesia) — _Default language_
    - `en` (English)
- **Namespaces Terpisah**:
    - `core`: Pesan sistem, otorisasi, penanganan error umum, disclaimer AI.
    - `tools`: Pesan respon utility dan tools umum.
    - `games`: Pesan minigame non-kasino (misal: tebak angka, coinflip, dice).
    - `casino`: Pesan game kasino & taruhan (misal: slot, roulette).
    - `items`: Nama, deskripsi, dan kategori item inventory/shop.
- **Lokasi File Translasi**:
    - Sumber: `src/locales/{id,en}/{core,tools,games,casino,items}.json`
    - Output Produksi: `dist/locales/{id,en}/*.json`

---

## 2. Aturan & Pola Baku (Core Guidelines)

### A. Penanganan Aset Build (`copy-locales.ts`)

`tsc` hanya mengompilasi file TypeScript (`.ts` -> `.js`) dan mengabaikan file `.json`. Oleh karena itu:

- **Build Synchronization**: Script `pnpm build` dikonfigurasi menjalankan `tsc && tsx scripts/copy-locales.ts`.
- **Runtime Fallback**: Fungsi `getLocalesDir()` di `src/locales/i18n.config.ts` memeriksa keberadaan file JSON nyata (`path.join(distPath, 'id', 'core.json')`). Jika file JSON tidak ditemukan di folder `dist/`, sistem otomatis fallback membaca direktori `src/locales`.

### B. Deteksi Missing Key yang Aman (`i18n.exists`)

Jangan pernah menggunakan pemeriksaan heuristik string sederhana seperti `key.endsWith('.' + res)` untuk mendeteksi kunci yang hilang:

```typescript
// ❌ SALAH: Menimbulkan false-positive jika value sama dengan segmen terakhir key
// Contoh: "tools.cancel" dengan nilai "cancel" dianggap hilang/missing!
const isMissing = res === key || key.endsWith('.' + res);

// ✅ BENAR: Gunakan API native i18next
const existsInTarget = i18n.exists(key, { lng: finalLang });
const existsInFallback = i18n.exists(key, { lng: 'id' });
```

### C. Kompatibilitas JID vs LID pada Resolusi Bahasa

Sesuai dengan arsitektur Baileys v7+, identifikasi pengguna dapat berupa format JID (`@s.whatsapp.net`) atau LID (`@lid`).

- Saat membaca preferensi bahasa pengguna di obrolan pribadi (DM) dari database:

```typescript
let user = await prisma.user.findUnique({
    where: { jid: senderJidDb },
    select: { language: true }
});

// WAJIB: Fallback ke senderLidDb jika user tidak ditemukan lewat JID
if (!user && senderLidDb && senderLidDb !== senderJidDb) {
    user = await prisma.user.findUnique({
        where: { jid: senderLidDb },
        select: { language: true }
    });
}
```

### D. Hierarki Resolusi Bahasa Chat

Resolusi bahasa dieksekusi secara otomatis pada level handler pesan (`src/handlers/message.ts`):

1. **Obrolan Pribadi (DM)**: Preferensi bahasa pengguna (`User.language`) -> Default (`id`).
2. **Obrolan Grup**: Preferensi bahasa grup (`WhitelistedGroup.language`) -> Default (`id`).
3. Bahasa hasil resolusi (`ctx.lang`) dan fungsi translator (`ctx.t`) disuntikkan langsung ke dalam objek `ToolExecutionContext`.

### E. Larangan Mixed-Language Outputs

Dilarang menggabungkan string terjemahan `ctx.t(...)` dengan string statis bahasa Inggris manual di dalam tool.

```typescript
// ❌ SALAH: Bahasa campuran (Mixed-language)
return ctx.t('tools.balance.title') + `\nKeep playing and claim your daily reward!`;

// ✅ BENAR: Semua baris teks terdefinisi di file JSON dengan interpolasi
return `${ctx.t('tools.balance.title', { balance })}\n${ctx.t('tools.balance.keep_playing')}`;
```

### F. Bahasa Respon Perintah Ganti Bahasa (`.setlang` / `.setgrouplang`)

Saat pengguna berhasil mengubah preferensi bahasa, pesan konfirmasi **WAJIB** disampaikan dalam bahasa target yang baru dipilih, bukan bahasa sebelumnya:

```typescript
// ✅ Gunakan getTranslator dengan targetLang yang baru disetel
const langName = LANGUAGE_CONFIG[targetLang]?.nativeName || targetLang;
const t = getTranslator(targetLang);
return t('tools.setlang.success', { language: langName });
```

### G. Standar Kompatibilitas Deskripsi Perintah i18n (Command Description i18n Standards)

Setiap tool di `src/tools/` wajib mendukung lokalisasi deskripsi perintah:

1. **Deklarasi `ToolDefinition`:**
    - Menyertakan atribut `descriptionKey` berformat `tools.commands.<clean_name>.description`.
    - Tetap menyediakan `description` bahasa Inggris default sebagai fallback dan fungsi Groq tool calling.

```typescript
export const definition: ToolDefinition = {
    name: 'balance',
    aliases: ['bal', 'saldo'],
    description: "Check your current casino coin balance or another user's balance.",
    descriptionKey: 'tools.commands.balance.description',
    category: 'Casino',
    parameters: { type: 'object', properties: {} }
};
```

2. **Penyimpanan Simetris di `tools.json`:**
    - Semua deskripsi perintah disimpan dalam objek `"commands"` di `src/locales/{en,id}/tools.json`:

    ```json
    "commands": {
        "balance": {
            "description": "Check your current casino coin balance or another user's balance."
        }
    }
    ```

3. **Resolusi Dinamis via Helper:**
    - Gunakan `resolveToolDescription(tool, t)` dari `src/tools/types.ts` atau `menuService.getToolDescription(tool, t)` untuk merender teks deskripsi pada tampilan menu/help.

---

## 3. Cara Menambahkan & Menggunakan Translasi Baru

### 1. Tambahkan Key ke Kedua Bahasa (`id` dan `en`)

Pastikan setiap key baru ditambahkan secara simetris di kedua file JSON:

- `src/locales/id/tools.json`
- `src/locales/en/tools.json`

### 2. Mengakses Translasi di Dalam Tool

Di dalam setiap file tool (`src/tools/*.ts`):

```typescript
export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    // Panggilan sederhana
    const header = ctx.t('tools.mytool.header');

    // Interpolasi parameter
    const message = ctx.t('tools.mytool.result', {
        name: senderName,
        amount: formatRupiah(amount)
    });

    return message;
}
```

### 3. Validasi & Verifikasi

Setelah menambah atau mengubah file translasi, jalankan verifikasi:

```bash
# Memeriksa simetri key antara id dan en
pnpm run validate:i18n

# Menjalankan unit tests i18n
pnpm exec tsx tests/i18n.test.ts

# Memastikan build menyalin JSON ke dist/
pnpm build
```
