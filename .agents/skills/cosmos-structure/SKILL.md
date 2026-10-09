---
name: cosmos-structure
description: >
    Panduan baku struktur folder dan penamaan file kode Cosmos: commands/,
    events/, handlers/, lib/ — konvensi camelCase/kebab-case, batasan peran
    tiap folder, dan tabel keputusan penempatan kode baru.
---

# Cosmos Source Structure & Naming Standards

## Konteks & Ringkasan

`src/` dibagi empat folder berdasarkan **peran**, bukan topik. Nama folder/file
memberi tahu *jenis apa* sebuah modul sebelum dibuka. siden itu, `src/services/`
menampung logika domain.

```
src/
├── commands/            # DEFINISI command bot saja — satu file per command
│   ├── types.ts         # CommandDefinition / CommandModule (kontrak bersama)
│   ├── casino/  system-help/  group/  economy-banking/  tools-utilities/
│   ├── media-stickers/  ai-correction/  settings/  employment/
│   └── downloaders/  music-audio/       # 11 subfolder kebab-case
├── events/              # Subscriber event platform (Baileys) — satu file per event
│   ├── index.ts         # registerEvents(sock, ctx) — satu-satunya entry point
│   ├── eventContext.ts  # EventContext: state mutable per koneksi (typed)
│   └── connection.ts  contacts.ts  presence.ts  participants.ts  messages.ts
├── handlers/            # Pipeline request milik Cosmos: parse -> resolve -> execute
│   ├── message.ts       # Parse inbound + greedy longest-prefix resolution
│   └── commandHandler.ts# Registry + dispatch (CommandsHandler)
├── lib/                 # Helper bersama — tanpa pengetahuan socket/command
│   ├── sticker/  security/
│   └── casino.ts  currency.ts  monospace.ts  cancellationManager.ts
│       connectionManager.ts  versioning.ts  ... (~37 modul)
├── services/            # Logika domain: bankService, loanService, jobs,
│   ├── agent/           # CosmosAgentEngine (dulu agentEngine/)
│   └── notifier/        # Status notifier (dulu statusNotifier/)
├── cli/  locales/  mcp/  seeds/  generated/
├── db.ts  index.ts
```

## 1. Konvensi Penamaan (WAJIB)

- **File = camelCase, tanpa pengecualian** (`applyLicense.ts`, `blacklistAdd.ts`,
  `messageCache.ts`). Filename tidak mengkodekan string pemanggilan —
  `definition.name` adalah satu-satunya sumber kebenaran untuk string command
  (misal file `applyLicense.ts` ↔ `.apply license`).
- **Folder = kebab-case, sependek mungkin** (`media-stickers/`, bukan
  `media/stickers/`; `agent/`, bukan `agent/engine/`). Kata redundan **dihapus**,
  bukan di-nest.
- **Subfolder `commands/` == `kebabCase(CATEGORY_SLUGS[normalizeCategory(def.category)])`.**
  Satu transformasi kebab-case dari slug `.menu` yang sudah diketik pengguna.
  Nilai `CATEGORY_SLUGS`/`CATEGORY_MAP` (underscore, misal `economy_banking`)
  adalah input pengguna — **jangan diubah**.

## 2. Batasan Peran Tiap Folder

| Folder | Berisi | DILARANG berisi |
| :--- | :--- | :--- |
| `commands/` | Definisi command (`definition` + `execute`) + `types.ts` | Registry, dispatch, socket handling |
| `events/` | Callback yang **dinaikkan platform** (`sock.ev.on(...)`) | Logika parse/resolve command |
| `handlers/` | Pipeline milik Cosmos: parse teks → resolve command → execute | Subscription event Baileys |
| `lib/` | Helper murni tanpa pengetahuan socket/command | Import dari `commands/`, `events/`, `handlers/` |
| `services/` | Logika domain & infrastruktur | Definisi command |

Pemisah `events/` vs `handlers/`: *siapa yang menaikkannya*. `events/` =
"WhatsApp memberi tahu sesuatu" (`messages.upsert`, `group-participants.update`).
`handlers/` = "pengguna mengetik command". Jangan gabungkan keduanya.

## 3. Tabel Keputusan Penempatan Kode Baru

| Saya menulis ... | Taruh di ... |
| :--- | :--- |
| Command bot baru (`.bank deposit`, `.daily claim`) | `src/commands/<kategori-kebab>/namaCamel.ts` + daftar `descriptionKey` di `en/id/tools.json` |
| Reaksi ke event Baileys baru | `src/events/<nama-event>.ts` + daftarkan di `registerEvents()` **pada urutan yang benar** (`connection.update` dulu — readiness bersifat load-bearing) |
| Perubahan parse/resolusi/dispatch command | `src/handlers/message.ts` / `commandHandler.ts` |
| Helper format/parse/validasi generik | `src/lib/<namaCamel>.ts` |
| Aturan bisnis (bank, loan, job, shop) | `src/services/<domain>Service.ts` |

## 4. Yang SENGAJA Tidak Di-Rename (Jangan "Perbaiki")

- `src/mcp/tools/` — permukaan protokol MCP (`cosmos_db_*`), bukan command bot.
- `src/services/agent/tools/` — registry tool milik agent, bukan command bot.
- Namespace i18n `tools.json` + key `tools.commands.*` — rename mengguncang
  5 file × 2 bahasa tanpa manfaat; folder dan namespace kini berbeda by design.
- Alias kompatibilitas `ToolDefinition` (= `CommandDefinition`) dan
  `ToolsHandler` (= `CommandsHandler`) — kode baru **wajib** memakai nama
  `Command*`; alias hanya untuk kompatibilitas baca.
- Path runtime `dist/commands` + `src/commands` di `commandHandler.ts` adalah
  literal — bila folder dipindah lagi, kedua literal ini wajib ikut.

## 5. Checklist Verifikasi Struktur

```bash
find src tests scripts -name '*_*.ts'   # harus kosong (camelCase)
# commands/ hanya berisi types.ts + 11 folder kategori (tanpa handler.*)
# setiap file: kebabCase(slug(normalizeCategory(def.category))) === basename(dirname(file))
pnpm typecheck && pnpm lint && pnpm build
pnpm test   # terisolasi via DATABASE_URL/STORAGE_DIR scratch — tidak menyentuh storage/
```
