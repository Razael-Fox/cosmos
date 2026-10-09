---
name: rupiah-currency-formatting
description: >
    Aturan baku untuk selalu menggunakan konvensi format mata uang Rupiah (IDR) lokal secara global (Rp tanpa spasi, pemisah ribuan titik, tanpa desimal) dan memanfaatkan utility src/lib/currency.ts.
---

# Indonesian Rupiah (IDR) Currency Standards

## Konteks & Ringkasan

Seluruh fitur dalam repositori Cosmos yang menangani nilai uang/saldo/taruhan (ekonomi, kasino, minigame, transfer, reward, vault) **WAJIB** menggunakan konvensi format mata uang lokal Indonesia (bukan format internasional/ISO dengan koma ribuan).

Semua format dan parsing nilai mata uang Rupiah harus didelegasikan ke modul utility global:
`src/lib/currency.ts`.

---

## Aturan Format Baku

| Elemen                 | Aturan Lokal Baku                     | Contoh Benar              | Contoh Salah              |
| ---------------------- | ------------------------------------- | ------------------------- | ------------------------- |
| **Simbol**             | `Rp` tepat di depan angka tanpa spasi | `Rp10.000`, `Rp1.000.000` | `Rp 10.000`, `IDR 10,000` |
| **Pemisah Ribuan**     | Titik (`.`)                           | `Rp1.500.000`             | `Rp1,500,000`             |
| **Pemisah Desimal**    | Koma (`,`) jika ada                   | `Rp1.000.000,50`          | `Rp1.000.000.50`          |
| **Penggunaan Desimal** | Tanpa angka desimal secara default    | `Rp15.000`                | `Rp15.000,00`             |

---

## Utility Global (`src/lib/currency.ts`)

Selalu import dan gunakan helper dari `src/lib/currency.ts`:

### 1. Formatting (`formatRupiah`)

```typescript
import { formatRupiah } from '../lib/currency.js';

// Format angka atau BigInt ke Rupiah lokal
formatRupiah(1000000); // "Rp1.000.000"
formatRupiah(user.balance); // "Rp10.000"
```

### 2. Parsing User Input (`parseCurrencyAmount`)

```typescript
import { parseCurrencyAmount } from '../lib/currency.js';

// Mendukung:
// - Titik ribuan: "1.000.000" -> 1000000
// - Desimal lokal: "1.000.000,00" -> 1000000
// - Shorthand: "10k" -> 10000, "1.5m" -> 1500000, "2jt" -> 2000000
// - Keyword: "all" / "allin" -> seluruh saldo
const bet = parseCurrencyAmount(args.input, Number(user.balance));
```

---

## Yang Dilarang (Don'ts)

- ❌ **Dilarang** memformat string manual dengan hardcoded `"Rp " + num.toLocaleString('id-ID')` atau `"Rp " + amount` (karena berpotensi spasi ganda atau format tidak konsisten).
- ❌ **Dilarang** menggunakan regex pemecah angka manual (`match(/\d+/)` atau `parseInt(input)`) yang membuang atau merusak tanda titik ribuan (misal `1.000.000` menjadi `1`).
- ❌ **Dilarang** menggunakan pemisah ribuan koma (`Rp1,000,000`).
