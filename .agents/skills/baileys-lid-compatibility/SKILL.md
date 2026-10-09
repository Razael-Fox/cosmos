---
name: baileys-lid-compatibility
description: Panduan menangani perbedaan JID dan LID pada library Baileys terbaru untuk pencocokan dan identifikasi pengguna.
---

# Baileys JID vs LID Compatibility Guideline

## Masalah

Pada WhatsApp dan library Baileys terbaru, pengenal pengguna (user/chat JID) secara bertahap digantikan oleh LID (Local Identifier, format `[id]@lid`) demi privasi. Jika kita membandingkan JID/LID mentah secara langsung (misalnya `xxx@s.whatsapp.net` dengan `xxx@lid`), atau menyertakan device ID (`xxx:device@s.whatsapp.net`), perbandingan akan gagal dan menyebabkan bug pada logika identifikasi pesan bot sendiri (`fromMe`).

## Solusi / Skill

Normalisasikan semua bentuk pengenal (JID/LID/Device JID) dengan memotong string sebelum karakter `:` dan `@` untuk mengambil ID dasarnya saja sebelum melakukan perbandingan.

```javascript
const cleanId = (idStr) => (idStr ? idStr.split(':')[0].split('@')[0] : null);

const botRawJid = cleanId(sock.user?.id); // e.g. "628xxx"
const botRawLid = cleanId(sock.user?.lid); // e.g. "1203xxx"
const participantRaw = cleanId(contextInfo.participant); // e.g. "628xxx" or "1203xxx"

const isQuotedFromMe =
    !contextInfo.participant ||
    (botRawJid && participantRaw === botRawJid) ||
    (botRawLid && participantRaw === botRawLid);
```

## Mentions (Green Mentions)

Menebak secara manual apakah sebuah ID menggunakan domain `@s.whatsapp.net` atau `@lid` (misal berdasarkan panjang string) sangat rawan kesalahan. Jika domain yang dimasukkan ke array `mentions` tidak valid, WhatsApp tidak akan merender mention hijau dan pushname tidak akan muncul (hanya tampil sebagai plain text seperti `@+297...`).

Gunakan utility global `formatMentions` yang ada di `src/lib/casino.ts` untuk mengisi array `mentions`. Fungsi ini secara otomatis mendeteksi apakah ID tersebut adalah JID atau LID berdasarkan panjangnya, lalu menggunakan domain yang tepat (`@s.whatsapp.net` atau `@lid`). DILARANG memasukkan dua domain sekaligus untuk satu ID karena WhatsApp akan gagal meresolve dan menampilkannya sebagai "@Unknown user".

```typescript
import { formatMentions } from '../lib/casino.js';

// Dalam fungsi execute:
const mentions = formatMentions(user.id);

await sock.sendMessage(jid, {
    text: `@${user.id} hello!`,
    mentions
});
```
