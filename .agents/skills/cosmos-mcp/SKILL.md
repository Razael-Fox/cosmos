---
name: cosmos-mcp
description: >
    Panduan baku untuk AI Coding Agent (OpenCode, Claude Code, Pi, Antigravity) saat
    mengerjakan Cosmos. Seluruh operasi Cosmos WAJIB lewat Cosmos MCP tool
    (cosmos_db_*, cosmos_*, cosmos_bot_*) — dilarang memakai npm/npx, dilarang
    menginstall CLI ad-hoc, dilarang menulis skrip sekali-pakai, dan dilarang
    membuka SQLite langsung. Termasuk peta intent ke tool, alur plan sebelum mutate,
    guardrail fail-closed single-owner key, dan privasi contact_ref.
---

# Cosmos MCP Server — Panduan Agent (Rule AH)

Issue #49 lahir dari satu kegagalan berulang: setiap kali agent perlu menyentuh Cosmos,
ia memakai tool generik bawaan — `npm install`, `npx <paket-ad-hoc>`, atau skrip
`scripts/broadcast.mjs` sekali pakai yang menduplikasi logika, melewati seluruh guardrail,
dan meninggalkan file sampah di repo.

**Cosmos sekarang punya antarmuka agent-side. Gunakan itu.**

---

## 1. Hard Rule

> **Cosmos operations MUST be performed through the Cosmos MCP tools.**

| Larangan                                | Kenapa                                                                                                                         |
| :-------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| `npm install` / `npx` / `yarn`          | Proyek PNPM-only. Perintah ini mendestabilisasi `pnpm-lock.yaml` dan memasang salinan ganda `baileys` / `prisma` / `groq-sdk`. |
| `pnpm add <paket-cli>` untuk satu tugas | Setiap kebutuhan Cosmos sudah punya tool. Paket ad-hoc hanya menambah permukaan serangan.                                      |
| `scripts/*.mjs` sekali pakai            | Tidak direviewable, tidak teraudit, melewati `ActivityLog`, rate limit, sanitasi JID, dan `console.log` Pterodactyl.           |
| `sqlite3 storage/database.sqlite`       | Melewati Prisma, melangkahi aturan ACID dan mirror DDL Rule W.                                                                 |
| Menebak nama kolom                      | Menimbulkan error `no such column` dan merusak dua sumber kebenaran skema.                                                     |

Command yang benar:

```bash
pnpm install          # hanya bila node_modules memang belum ada
pnpm typecheck
pnpm lint
pnpm build
pnpm test             # opsional
```

---

## 2. Orientation: dua langkah pertama

Di workspace baru, dari clone lain, atau dari `.worktrees/api`:

1. **`cosmos_guidance`** — kontrak kerja + peta intent → tool.
2. **`cosmos_db_describe`** — katalog model live dari `prisma/schema.prisma`.

Tidak perlu `node_modules`, tidak perlu Prisma client, tidak perlu `dist/`. Tool berjalan
dari deployment Cosmos.

---

## 3. Peta Intent → Tool

| Intent                             | Tool                                                                                      | Catatan                                                                                                 |
| :--------------------------------- | :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| Broadcast pengumuman ke semua grup | `cosmos_bot_broadcast`                                                                    | **Satu panggilan.** `delayMs: 5000` persis seperti yang diminta. Jadwal dipersistensi, bisa dibatalkan. |
| Kirim pesan ke user/grup tertentu  | `cosmos_bot_groups_list` → `cosmos_bot_send_message`                                      | Ambil `contactRef` dari daftar grup; jangan hardcode JID.                                               |
| Update / insert / delete baris DB  | `cosmos_db_describe` → `cosmos_db_mutation_plan` → `cosmos_db_apply_mutation`             | Plan dulu, apply kemudian. Apply menolak tanpa `planFingerprint` yang cocok.                            |
| Laporan / agregasi data            | `cosmos_db_query`, `cosmos_db_count`, `cosmos_db_aggregate`, `cosmos_db_settings_summary` | Read-only. `LIMIT` wajib.                                                                               |
| Cari tahu perintah bot yang ada    | `cosmos_feature_list`, `cosmos_feature_describe`                                          | Mengembalikan invokasi berspasi yang benar, misal `.bank deposit`.                                      |
| Jalankan / validasi perintah bot   | `cosmos_feature_invoke`                                                                   | Dry-run secara default.                                                                                 |
| Ubah konfigurasi runtime           | `cosmos_settings_get`, `cosmos_settings_set`                                              | Konfigurasi ada di DB, bukan di `.env`.                                                                 |
| Cek paritas terjemahan             | `cosmos_i18n_check`                                                                       | Memenuhi Rule O sebagai tool call.                                                                      |
| Cek skema & tata kelola repo       | `cosmos_schema_check`, `cosmos_db_migration_status`                                       | Rule W (DDL 3-fase + dual maintenance) dan Rule X (isolasi worktree).                                   |
| Kesehatan / reconnect / logout bot | `cosmos_bot_status`, `cosmos_bot_health`, `cosmos_bot_reconnect`, `cosmos_bot_logout`     | `BOT_OFFLINE` bila engine mati.                                                                         |
| Sub-bot                            | `cosmos_bot_subbot_list`, `cosmos_bot_subbot_status`                                      | Pairing code hanya diterbitkan engine.                                                                  |
| Backup / restore                   | `cosmos_db_backup`, `cosmos_db_restore_plan`                                              | Restore bersifat plan-only.                                                                             |

---

## 4. Alur Mutasi yang Benar (Wajib)

```text
cosmos_db_describe           → konfirmasi kolom benar-benar ada
        ↓
cosmos_db_mutation_plan      → safe? boilerplate $transaction? butuh DDL Rule W?
        ↓  (hanya bila safe === true)
cosmos_db_apply_mutation     → planFingerprint + confirm bila destruktif
```

Aturan yang tidak bisa dinegosiasi:

- `planFingerprint` **wajib** Identik dengan hasil plan. Plan untuk request A tidak bisa
  dipakai untuk request B — sistem menolak dengan `PLAN_REQUIRED`.
- `delete` **wajib** `confirm: true` **dan** `acknowledgedRowCount` yang cocok dengan
  pratinjau; bila jumlah baris berubah di antara plan dan apply, apply ditolak.
- Bulk delete di atas `COSMOS_MCP_MAX_BULK_DELETE_ROWS` ditolak.
- Kolom yang tidak ada di `schema.prisma` ditolak sebagai blocker — plan tidak pernah
  diam-diam mengarang skema.
- Bila plan melaporkan `requiresDdlMigration: true`, mirror perubahan ke `prisma/schema.prisma`
  **dan kedua** driver DDL (`src/db.ts` serta `.worktrees/api/src/db.ts`) dengan urutan
  3-fase Rule W: `CREATE TABLE` → `ensureColumnExists` → `CREATE INDEX`.
- Bila plan melaporkan `requiresAcidTransaction: true` atau `requiresBalanceAfter: true`,
  perubahan menyentuh ledger bank / pinjaman / ekonomi dan wajib atomik.

---

## 5. Contoh: permintaan yang dulunya butuh skrip

> _"Tolong siarkan ke semua grup bahwa bot akan undergoing maintenance, dengan jeda 5 detik per grup."_

Dulu: tulis `scripts/broadcast.mjs`, hardcode delay, hardcode daftar grup, jalankan,
sisakan file.

Sekarang:

```jsonc
// 1. Dry-run: melihat target dan estimasi durasi tanpa mengirim apa pun.
{ "name": "cosmos_bot_broadcast",
  "arguments": { "message": "The bot will undergo scheduled maintenance shortly. Thank you for your patience.",
                 "delayMs": 5000, "dryRun": true } }

// 2. Kirim sungguhan.
{ "name": "cosmos_bot_broadcast",
  "arguments": { "message": "The bot will undergo scheduled maintenance shortly. Thank you for your patience.",
                 "delayMs": 5000, "dryRun": false, "confirm": true } }

// 3. (Opsional) Receipt per grup.
{ "name": "cosmos_bot_broadcast_status", "arguments": { "jobId": "bcast_..." } }
```

---

## 6. Autentikasi: Single-Owner Key, Fail Closed

- Seluruh toolset berada di balik **satu** API key: `COSMOS_MCP_TOKEN`.
- Key tersebut dipegang **repository owner** secara pribadi. Tidak ada key per-agent,
  per-workspace, per-client, atau tim. Tidak ada signup, tidak ada rotasi otomatis,
  tidak ada backdoor.
- **Hanya owner** yang dapat me-reset atau merotasi: regenerate di secret manager →
  redeploy → reconfigure semua client.
- Key **tidak boleh** masuk repo, image Docker (jangan pernah jadi `ARG`), atau respons tool.
- Bila key kosong, server **gagal start**; request HTTP tanpa key → `401 UNAUTHORIZED_MCP`.
  Tidak ada mode anonim, key default, key dev, atau bypass loopback.
- Audit merekam **pemilik** (`repository-owner`), bukan credential-nya, sehingga jejak audit
  tetap utuh setelah rotasi.

Konsekuensi yang harus dirancang: kebocoran berarti kebocoran total, dan pencabutan bersifat
penuh serta seketika. Itulah harga yang disepakati untuk jaminan bahwa tidak ada collaborator,
agen pihak ketiga, atau config yang bocor yang dapat mencapai ledger bank/pinjaman atau
kemampuan broadcast.

---

## 7. Privasi Kontak

- Nomor telepon dan JID mentah **tidak pernah** keluar dari server.
- Semua JID dikembalikan dalam bentuk masked, berdampingan dengan alias ephemeral
  `contact_ref_...` (TTL 3 menit, LRU 10.000, hanya RAM).
- Gunakan `contactRef` tersebut sebagai `target` untuk `cosmos_bot_send_message` atau
  `cosmos_bot_broadcast`. Alias kedaluwarsa ditolak, bukan diasumsikan valid.

---

## 8. Nol Data Palsu

Bila engine tidak terjangkau, tool bot mengembalikan `BOT_OFFLINE`. **Jangan** menebak,
**jangan** mengarang nomor, kode pairing, atau QR. Keberhasilan tiruan lebih berbahaya
daripada kegagalan yang jujur.

---

## 9. Rujukan

- Aturan repo: `AGENTS.md` §AH.
- Dokumentasi operator (env, konfigurasi client, rotasi key): `docs/COSMOS_MCP.md`.
- Kode: `src/mcp/` (server), `src/services/broadcastService.ts` (fan-out persisten),
  `src/services/ipcServer.ts` (rute `/internal/...`).
- Test: `tests/cosmosMcp.test.ts`, `tests/smoke/cosmosMcpSmoke.mjs`.
