---
name: cosmos-versioning
description: Panduan baku format versi bertanggal Cosmos (G<generation>-F<feature>-P<patch>), metadata version.json, utility versioning.ts, dan prosedur bump serta publish rilis. Gunakan panduan ini setiap kali AI Agent perlu menaikkan, memvalidasi, mempublikasikan, atau menampilkan versi Cosmos, atau saat mengubah package.json, CHANGELOG.md, tag Git, dan workflow Docker publish.
---

# Cosmos Versioning Standards (Format Tanggal `G-F-P`)

> **Migrasi 2026-09-30.** Format lama `RF-YYMM-BUILD` (pra-rilis) dan SemVer (stabil) **sudah tidak berlaku**. Digantikan oleh satu format tanggal tunggal. Spesifikasi kanonik: `docs/VERSIONING.md`. Aturan utama di `AGENTS.md` Rule S.

---

## 1. Format Versi

```text
G<generation>-F<featureMilestone>-P<patch>[.<YYYY-MM-DD>][-<status>]
```

Contoh: `G2-F24-P7`, `G1-F12-P2.2026-09-30`, `G2-F24-P7.2026-09-30-beta`.

| Komponen | Arti                                                                                                                  |
| :------- | :-------------------------------------------------------------------------------------------------------------------- |
| `G`      | **Generation**. Naik pada restrukturisasi besar, migrasi DB mayor, penggantian framework, atau desain tak kompatibel. |
| `F`      | **Feature Milestone**. Naik saat sebuah fitur utama selesai dan siap dipakai.                                         |
| `P`      | **Patch**. Naik untuk perbaikan bug, validasi, optimasi, UI, dan pembaruan dokumentasi penting.                       |
| `.date`  | Tanggal rilis opsional, ISO 8601 (`YYYY-MM-DD`). Tidak dihitung sebagai increment.                                    |
| `status` | Stage opsional di akhir: `alpha`, `beta`, `rc1`, `stable`.                                                            |

Contoh makna `G2-F24-P7`: produk berada di Generasi 2, telah menyelesaikan 24 feature milestone, dan menerima 7 patch sejak milestone terakhir.

---

## 2. Kapan Harus Menaikkan Versi (WAJIB vs DILARANG)

| Situasi                                             | Increment                  | Contoh                    |
| :-------------------------------------------------- | :------------------------- | :------------------------ |
| Perbaikan bug, penambahan validasi, optimasi        | `patch`                    | `G2-F24-P7` → `G2-F24-P8` |
| Perbaikan UI / UX / teks tampilan                   | `patch`                    | `G2-F24-P7` → `G2-F24-P8` |
| Pembaruan dokumentasi penting (termasuk docs versi) | `patch`                    | `G2-F24-P7` → `G2-F24-P8` |
| Fitur utama selesai & siap dipakai                  | `feature` (P reset)        | `G2-F24-P7` → `G2-F25-P0` |
| Perubahan arsitektur mayor / migrasi database mayor | `generation` (F & P reset) | `G2-F40-P12` → `G3-F1-P0` |

**DILARANG menaikkan versi** untuk: penyuntingan teks, perubahan formatting, dan penyesuaian internal yang tidak mengubah perilaku produk.

---

## 3. Metadata Terpusat: `version.json`

Seluruh metadata versi disimpan di `version.json` pada root repo supaya mudah dikelola dan dipakai alat otomatis seperti CI/CD.

```json
{
    "version": "G2-F24-P7",
    "generation": 2,
    "featureMilestone": 24,
    "patch": 7,
    "releaseDate": "2026-09-30"
}
```

### Invarian (divalidasi oleh `pnpm run version:check`)

1. `version` **wajib** identik dengan `G${generation}-F${featureMilestone}-P${patch}`.
2. `generation`, `featureMilestone`, `patch` **wajib** bilangan bulat non-negatif.
3. `releaseDate` **wajib** ISO 8601 (`YYYY-MM-DD`) dan tanggal kalender yang valid.
4. Field `version` pada `package.json` **wajib** selalu sama dengan `version.json`.
5. Segmen tanggal dan status **tidak** disimpan di `version.json`; keduanya diturunkan saat rilis (tag / nama GitHub Release).

**Dilarang** menulis `version.json` secara manual dengan nilai yang tidak konsisten. Selalu gunakan `pnpm run version:bump` atau `serializeVersionFile()`.

---

## 4. Pembacaan Programatik: `src/utils/versioning.ts`

Versi **wajib** dibaca melalui utility terpusat ini. **Dilarang** mengambil versi dari `package.json` atau mem-parse `CHANGELOG.md` secara manual.

```typescript
import {
    getVersionInfo,
    formatVersion,
    parseVersion,
    bumpVersion,
    compareVersions,
    isValidVersion
} from './utils/versioning.js';

const info = getVersionInfo(); // { version, generation, featureMilestone, patch, releaseDate }
formatVersion(info); // "G2-F24-P7"
parseVersion('G2-F24-P7.2026-09-30-beta'); // { generation: 2, featureMilestone: 24, patch: 7, releaseDate: '2026-09-30', status: 'beta' }
bumpVersion(info, 'feature'); // { generation: 2, featureMilestone: 25, patch: 0 }
compareVersions('G2-F24-P8', 'G2-F24-P7'); // 1
```

| Fungsi                    | Kegunaan                                                          |
| :------------------------ | :---------------------------------------------------------------- |
| `getVersionInfo()`        | Baca + validasi `version.json` (accessor kanonik).                |
| `formatVersion(info)`     | Rakit string `G-F-P` dari komponen numerik.                       |
| `parseVersion(str)`       | Parse string versi; melempar error deskriptif bila tidak valid.   |
| `isValidVersion(str)`     | Varian non-throwing untuk validasi input eksternal.               |
| `bumpVersion(info, kind)` | Hitung versi berikutnya untuk `patch` / `feature` / `generation`. |
| `compareVersions(a, b)`   | Perbandingan semantik; segmen tanggal diabaikan.                  |
| `serializeVersionFile()`  | Tulis `version.json` dengan validasi invarian.                    |
| `validateVersionFile()`   | Validasi objek metadata tanpa menyentuh disk.                     |
| `formatDatedVersion()`    | Tempel segmen tanggal ISO pada versi.                             |
| `describeVersion()`       | Ringkasan human-readable untuk log.                               |

---

## 5. Perintah CLI

```bash
pnpm run version:show                    # tampilkan metadata versi
pnpm run version:show -- --json          # tampilkan isi mentah version.json
pnpm run version:check                   # validasi invarian + sinkronisasi package.json
pnpm run version:bump patch              # G2-F24-P7 -> G2-F24-P8
pnpm run version:bump feature            # G2-F24-P7 -> G2-F25-P0
pnpm run version:bump generation         # G2-F24-P7 -> G3-F1-P0
pnpm run version:bump patch -- --date 2026-10-01
```

---

## 6. Prosedur Publish Rilis

```bash
pnpm run release:pre                             # publish versi dari version.json
pnpm run release:pre -- --bump patch             # bump patch lalu publish
pnpm run release:pre -- --bump feature           # feature milestone baru lalu publish
pnpm run release:pre -- --bump generation        # generasi baru lalu publish
pnpm run release:pre -- --stable                 # terbit tanpa flag --prerelease
pnpm run release:pre -- --dry-run                # validasi penuh tanpa efek samping
pnpm run release:pre -- --no-push                # commit + tag lokal, skip push
```

`scripts/release.ts` melakukan secara berurutan: membaca `version.json` → menyelaraskan `package.json` → memvalidasi header `## [G2-F24-P7]` di `CHANGELOG.md` → commit → push branch → `gh release create` → unggah `CHANGELOG.md`.

### Checklist Pra-Rilis (WAJIB)

1. [ ] `pnpm typecheck` dan `pnpm lint` bersih.
2. [ ] `pnpm run version:check` lulus.
3. [ ] `CHANGELOG.md` memiliki section `## [<versi>] - <YYYY-MM-DD>` yang sesuai.
4. [ ] Increment versi **sudah** dilakukan bila ada perubahan produk.
5. [ ] `ISSUE.md` dan `SUMMARY.md` tidak ikut ter-stage (lihat Aturan I `AGENTS.md`).

### Tag & CI

- Tag Git memakai string versi apa adanya, **tanpa prefiks**: `G2-F24-P7`. Tag `v`-prefixed dan SemVer **dilarang**.
- `.github/workflows/docker-publish.yml` memicu build image pada tag yang cocok dengan `G[0-9]*-F[0-9]*-P[0-9]*` dan memvalidasi `version.json` sebelum build.

---

## 7. Sejarah & Transisi

- Rilis sebelum migrasi memakai `RF-YYMM-BUILD` (contoh: `RF-2609-21`) dan SemVer (`1.0.0`).
- Header `RF-*` di `CHANGELOG.md` **tetap dipertahankan apa adanya** sebagai catatan siklus pra-rilis dan **dilarang diubah**.
- Standar baru dimulai pada `G2-F24-P7` (release date `2026-09-30`).

---

## 8. Ringkasan Larangan

- **Dilarang** menggunakan format `RF-YYMM-BUILD` untuk rilis baru.
- **Dilarang** menggunakan SemVer (`1.0.0`, `v1.0.0`) untuk rilis baru.
- **Dilarang** menyimpan versi hanya di `package.json`; `version.json` adalah sumber kebenaran.
- **Dilarang** membaca versi dari `package.json` saat runtime atau di log.
- **Dilarang** mengedit `version.json` secara manual tanpa menjaga invarian.
