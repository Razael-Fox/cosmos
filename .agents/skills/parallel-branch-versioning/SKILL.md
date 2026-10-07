---
name: parallel-branch-versioning
description: >
    Panduan baku penanganan tabrakan nomor versi antar branch Cosmos yang berjalan paralel (dua PR dari satu commit menghasilkan versi G-F-P yang identik), prosedur rebase-lalu-rebump yang diwajibkan, serta semantik Feature Milestone (F) sebagai penghitung milestone beserta registry-nya. Gunakan panduan ini setiap kali AI Agent membuat branch/PR baru, menjalankan version:bump pada branch yang sudah basi, melihat CI melaporkan "Version collision", atau menaikkan feature milestone F.
---

# Parallel Branch Versioning & Feature Milestone Standards

Dokumen ini melengkapi skill `cosmos-versioning`. Skill tersebut menjelaskan **format** `G<generation>-F<feature>-P<patch>`; dokumen ini menjelaskan **dua jebakan operasional** yang menyebabkan versi rusak di Cosmos:

1. **Tabrakan nomor versi antar branch paralel** — terdeteksi _setelah_ merge ke `main`, bukan saat PR dibuka.
2. **Feature Milestone (`F`) yang tidak self-describing** — angka `F` tidak pernah menjelaskan milestone apa yang diwakili.

Aturan utama di `AGENTS.md` Rule S dan S.1. Spesifikasi kanonik di `docs/VERSIONING.md`.

---

## 1. Akar Masalah: `version:bump` Membaca File LOKAL

`pnpm run version:bump` menghitung versi berikutnya dari **`version.json` di working copy lokal**, bukan dari base branch:

```typescript
// scripts/release/version.ts
const current = getVersionInfo(); // <-- membaca disk, bukan origin/main
const next = bumpVersion(current, kind);
```

Akibatnya dua PR yang bercabang dari commit yang sama menghitung versi berikutnya yang **identik**:

```text
main       G2-F24-P8
├─ PR-A    G2-F24-P8 → G2-F24-P9   (merged duluan)  → main = G2-F24-P9
└─ PR-B    G2-F24-P8 → G2-F24-P9   (masih terbuka)  → TABRAKAN
```

PR-B **tahu** versinya sudah dipakai, tetapi tidak punya mekanisme untuk mengetahuinya. Consequences:

- `version.json` konflik saat merge, **atau** (lebih buruk) PR-B diam-diam mendarat dengan versi duplikat.
- Dua state kode berbeda mengklaim satu versi yang sama.
- `CHANGELOG.md` memiliki dua section untuk satu versi.
- Tag `G2-F24-P9` menjadi ambigu: menunjuk ke commit mana?

---

## 2. Mengapa CI Lama Tidak Menangkapnya

`version:verify --base <merge-base>` hanya membandingkan dengan **merge base**, yaitu commit tempat branch PR-A dibuat. Head PR-B (`G2-F24-P9`) memang lebih besar dari merge base (`G2-F24-P8`), jadi pemeriksaan itu **lulus**, padahal `main` sudah berada di `G2-F24-P9`.

Konsekuensinya kegagalan baru muncul **setelah merge**, di `main`:

```text
push ke main → version-policy compare against github.event.before
             → head == before → "must be strictly greater than base version" GAGAL
```

Artinya bug baru terdeteksi ketika damage sudah masuk branch utama dan harus dibatalkan/revert manual.

### Perbaikan: `--against`

`scripts/release/version.ts` kini menerima flag `--against <ref>` yang membandingkan versi branch dengan **tip base branch saat ini**, bukan hanya merge base:

```bash
pnpm run version:verify -- --base <base-sha> --against origin/main
```

`.github/workflows/version-policy.yml` menjalankannya pada **setiap pull request**, sehingga tabrakan tertangkap **saat PR masih terbuka** — sebelum manusia merge apa pun. Pesan diagnostiknya memuat prosedur resolusi siap pakai.

| Pemeriksaan            | Menangkap tabrakan?                                 |
| :--------------------- | :-------------------------------------------------- |
| `--base` saja          | Tidak — membandingkan merge base, selalu "melewati" |
| `--base` + `--against` | Ya — membandingkan tip base branch saat ini         |

---

## 3. Prosedur Wajib Saat CI Melaporkan `Version collision`

**DILARANG** memaksa merge, mengabaikan CI, atau mengedit `version.json` secara manual. Ikuti urutan ini:

```bash
# 1. Ambil state terbaru base branch
git fetch origin

# 2. Rebase (BUKAN merge) agar histori tetap linear
git rebase origin/main

# 3. Bump ulang — kini `version:bump` membaca versi segar dari `main` hasil rebase
pnpm run version:bump patch|feature|generation

# 4. Validasi
pnpm run version:check

# 5. Commit + force-push dengan lease (menjaga revisi orang lain)
git commit -am "chore(versioning): rebump to <new version>"
git push --force-with-lease
```

Mengapa **rebase** dan bukan `git merge origin/main`? Rebase menaruh commit bump versi tepat di atas kode yang sudah di-rebase, sehingga diff PR tetap bersih dan nomor versi langsung terlihat sebagai milik branch ini. Merge base_branch akan menghasilkan commit merge yang memperumit diff dan sering membuat CI menghitung base yang ambigu.

Mengapa `--force-with-lease` dan bukan `--force`? `--force-with-lease` gagal dengan aman bila ada orang lain yang sudah push ke branch tersebut, sehingga Anda tidak menimpa tanpa sadar.

### Aturan Urutan Merge

> **Merge terakhir menang memakai nomor tertinggi.** Nomor versi yang dialokasikan sebelum merge **tidak dijamin bertahan**.

Artinya "rebump setelah rebase" adalah **bagian normal** dari land PR, **bukan** kondisi error. Jangan menahan PR hanya karena versinya perlu diubah.

---

## 4. Semantik Feature Milestone (`F`)

`F` adalah **penghitung milestone**, **bukan** daftar fitur.

| Versi        | Makna benar                                                             | Makna SALAH                |
| :----------- | :---------------------------------------------------------------------- | :------------------------- |
| `G2-F24-P10` | Generasi 2, **24 milestone fitur selesai**, 10 patch sejak milestone 24 | "24 fitur ada di codebase" |

`F24` **tidak** menyatakan apa pun tentang jumlah fitur yang ada. Ia menyatakan berapa banyak milestone yang telah _selesai dan siap dipakai_. Deretan patch di bawah `F` yang tidak berubah (`P0 → P1 → … → P10`) berarti **milestone 24 masih terbuka dan sedang menerima perbaikan**.

### Kewajiban pada Bump `feature`

Karena angka `F` tidak self-describing, setiap bump **`feature`** (yang menaikkan `F`) **wajib**:

1. Menambahkan section `## [G<n>-F<m>-P0] - <YYYY-MM-DD>` di `CHANGELOG.md` yang **menyebut milestone** tersebut.
2. Menambahkan baris ke tabel **registry milestone** di `docs/VERSIONING.md` bagian "Feature Milestone Semantics".
3. Menyebut milestone tersebut pada deskripsi PR.

Bump **`patch`** tidak menaikkan `F`, sehingga **tidak** memerlukan entri registry baru.

### Registry Milestone

Registry ada di `docs/VERSIONING.md`. Milestone sebelum migrasi `G-F-P` (2026-09-30) dicatat sebagai _tidak dipetakan secara individual_ — **jangan** merekonstruksinya dengan tebakan. Pemetaan yang dikarang lebih buruk daripada celah yang diakui secara jujur.

Saat bump `feature` menaikkan `F`, ganti placeholder dengan milestone baru lalu tambahkan placeholder untuk nomor berikutnya.

---

## 5. Checklist Sebelum Push

```bash
pnpm run version:check                                   # invarian + sinkron package.json
pnpm run version:verify -- --base HEAD                   # meniru CI
pnpm run version:verify -- --base HEAD --against origin/main  # deteksi tabrakan
```

- [ ] Jenis increment benar (`patch` / `feature` / `generation`)
- [ ] `version.json` + `package.json` + `CHANGELOG.md` satu commit dengan kode
- [ ] Bump `feature` → registry milestone diperbarui
- [ ] Tidak ada `Version collision` dari CI
- [ ] `ISSUE.md` / `SUMMARY.md` tidak ikut ter-stage (Aturan I)

---

## 6. Ringkasan Larangan

- **Dilarang** menaikkan versi di commit terpisah dari perubahan kode yang menjadi alasannya.
- **Dilarang** mengabaikan atau memaksa melewati kegagalan `Version collision`.
- **Dilarang** mengedit `version.json` manual untuk menyelesaikan tabrakan.
- **Dilarang** menyatakan `F` sebagai jumlah fitur di kodebase.
- **Dilarang** merekonstruksi registry milestone pra-migrasi dengan tebakan.
- **Dilarang** memakai `git push --force` (tanpa `--force-with-lease`).
