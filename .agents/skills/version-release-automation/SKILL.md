---
name: version-release-automation
description: Panduan baku sistem otomasi versi & rilis Cosmos di GitHub Actions (version-automation.yml, release.yml, version-policy.yml), klasifikasi bump otomatis berbasis Conventional Commits (feat: → feature, type!: / BREAKING CHANGE → generation, lainnya → patch), kewajiban penulisan commit message yang jujur, override manual via workflow_dispatch, dan prosedur verifikasi pasca-merge. Gunakan panduan ini setiap kali AI Agent menulis commit message, menaikkan versi, membuat tag/rilis, atau memeriksa hasil otomasi rilis.
---

> **Lihat juga `cosmos-versioning`** (format `G-F-P` dan `version.json`) dan **`parallel-branch-versioning`** (tabrakan versi antar branch & registry milestone). Panduan untuk tim testing: `HOW.md`.

# Version & Release CI Automation Standards

Dokumen ini menjelaskan bagaimana AI Agent **bekerja bersama** (bukan menyaingi) pipeline otomasi versi & rilis Cosmos yang hidup di `.github/workflows/`.

---

## 1. Peta Sistem (3 Workflow Berantai)

```text
Pull Request ──► version-policy.yml      (gerbang: kode berubah ⇒ version.json WAJIB berubah & naik)
                      │ merge / direct push
                      ▼
main         ──► version-automation.yml  (klasifikasi: nothing | tag-only | bump → commit [skip ci] → tag)
                      ▼
tag G*-F*-P* ──► release.yml             (GitHub Release berisi irisan section CHANGELOG.md)
             └─► docker-publish.yml      (image GHCR cosmos-origin)
```

Sumber kebenaran versi: **`version.json`**. Tag, judul rilis, dan `package.json` semuanya turunan.

---

## 2. Klasifikasi Bump Otomatis (Smart Classification)

Saat push ke `main` mengubah path bervedisi (`src/`, `prisma/`, `scripts/`, `docker/`, `.github/workflows/`) **tanpa** mengubah `version.json`, workflow membaca **commit message** push tersebut (prioritas tertinggi menang):

| Sinyal pada commit                                                            | Bump         | Contoh                      |
| :---------------------------------------------------------------------------- | :----------- | :-------------------------- |
| Footer `BREAKING CHANGE` / `BREAKING-CHANGE`, atau `type!:` / `type(scope)!:` | `generation` | `G2-F40-P3` → `G3-F1-P0`    |
| Subject `feat:` / `feat(scope):`                                              | `feature`    | `G2-F31-P11` → `G2-F32-P0`  |
| Lainnya (`fix:`, `chore:`, `docs:`, dll.)                                     | `patch`      | `G2-F31-P11` → `G2-F31-P12` |

Yang dilakukan bot (`github-actions[bot]`) pada mode bump:

1. `pnpm run version:bump <kind>` + `version:check`.
2. Menyisipkan section stub `## [<versi>] - <tanggal>` di puncak `CHANGELOG.md` berisi subject commit push tersebut (ekstraksi deterministik, bukan tulisan berhalusinasi).
3. Khusus `feature`: mengganti baris placeholder `_(open)_` di registry milestone `docs/VERSIONING.md` dengan milestone baru (dinamai dari subject `feat` pertama) dan mencetak placeholder berikutnya.
4. Commit `[skip ci]` (anti-loop) → push ke `main` → push tag → rantai rilis & Docker berjalan otomatis.

**Konsekuensi penting:** subject commit menjadi **bahan baku catatan rilis dan nama milestone**. Tulis subject yang layak tampil publik.

---

## 3. Kewajiban AI Agent

### 3.1 Kejujuran Tipe Commit (WAJIB)

Klasifier hanya sejujur commit message. AI Agent **WAJIB**:

- Memakai `feat:` / `feat(scope):` **hanya** untuk fitur yang benar-benar selesai & siap pakai (bukan WIP, bukan perbaikan).
- Memakai `fix:`, `chore:`, `docs:`, `refactor:`, `perf:` untuk perubahan patch-level.
- Menandai breaking change dengan `!:` (misal `feat(api)!: ...`) atau footer `BREAKING CHANGE: ...` — jangan menyembunyikan breaking change di balik `fix:`.
- **DILARANG** mengetik `feat:` sekadar untuk "mempercepat" naiknya `F`.

### 3.2 Alur Normal via PR (TETAP WAJIB Bump Manual)

Otomasi **tidak menghapus** kewajiban Rule S.1: di dalam PR, agent tetap menjalankan `pnpm run version:bump patch|feature|generation` + entri `CHANGELOG.md` tulisan manusia. Setelah merge, workflow melihat `version.json` sudah berubah → mode **tag-only** (bot hanya menag). Auto-bump hanyalah jaring pengaman untuk direct push.

### 3.3 Larangan Operasional

- **DILARANG** membuat tag Git atau GitHub Release manual untuk perubahan rutin — itu wilayah `version-automation.yml` + `release.yml`. Tag manual yang tidak cocok dengan `version.json` akan **gagal fail-closed** di `release.yml`.
- **DILARANG** mengedit commit `chore(versioning): auto-bump ... [skip ci]` atau menambahkan `[skip ci]` pada commit yang justru membutuhkan rantai rilis.
- **DILARANG** mengubah workflow di `.github/workflows/` tanpa bump `patch` (path ini termasuk pemicu CI yang ditegakkan otomatis).

### 3.4 Override Manual (Koreksi Salah Ketik Commit)

Bila commit salah ketik (misal fitur tertulis `fix:` → ter-bump patch), koreksi via **Actions → Version Automation → Run workflow** dan pilih `patch` / `feature` / `generation`. Workflow akan bump dari `main`, membuat stub CHANGELOG dari seluruh commit sejak tag terakhir, lalu menag. **Jangan** memperbaiki dengan force-push riwayat `main`.

### 3.5 Tabrakan Versi Antar Branch

Tidak berubah: dua PR paralel yang mengalokasikan nomor sama → yang merge terakhir wajib rebase + rebump (lihat skill `parallel-branch-versioning`). Otomasi tidak menyelesaikan tabrakan; ia hanya menag versi yang menang.

---

## 4. Verifikasi Pasca-Merge (Checklist Agent)

Setelah PR agent di-merge atau direct push:

1. `git fetch --tags && git tag -l 'G*'` — tag terbaru == `version.json` di `main`.
2. Halaman Releases — judul == tag; body berisi section CHANGELOG (bukan auto-generated notes), kecuali fallback berbunyi warning di log `release.yml`.
3. Commit auto-bump (bila ada) hanya menyentuh `version.json`, `package.json`, `CHANGELOG.md`, dan (feature saja) `docs/VERSIONING.md`.
4. Bump `feature`: registry milestone punya baris asli untuk `F` baru + placeholder `_(open)_` baru.
5. Tidak ada loop: run workflow setelah commit bot berakhir "nothing to do".

---

## 5. Troubleshooting Cepat

| Gejala                                               | Penyebab umum & tindakan                                                                                 |
| :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Rilis berisi daftar commit (bukan teks CHANGELOG)    | Section `## [<versi>]` hilang/salah nama pada commit yang ditag — periksa CHANGELOG.md pada tag tersebut |
| Job auto-bump gagal saat `git push origin HEAD:main` | Branch protection `main` menolak token Actions — longgarkan ruleset atau sediakan PAT                    |
| Tidak ada tag setelah merge PR                       | Baca log run `version-automation` — biasanya "tag already exists" (normal) atau klasifikasi gagal        |
| Kind bump salah (fitur jadi patch)                   | Commit message salah tipe — koreksi via workflow_dispatch (§3.4), bukan rewrite history                  |
| `release.yml` gagal "does not match version.json"    | Tag tidak cocok dengan `version.json` — hapus tag yang salah, jangan bypass                              |

Spesifikasi format: `docs/VERSIONING.md`. Aturan utama: `AGENTS.md` Rule S & Rule AI. Panduan tester: `HOW.md`.
