# Cosmos - WhatsApp Bot Framework

[![Version](https://img.shields.io/badge/version-G2--F24--P12-blue.svg)](version.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x%20|%2022.x%20|%2024.x-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PNPM](https://img.shields.io/badge/PNPM-8.x+-F69220.svg?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Baileys](https://img.shields.io/badge/Baileys-v7.0.0--rc14-25D366.svg?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Prisma](https://img.shields.io/badge/Prisma-v7.9+-2D3748.svg?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Groq AI](https://img.shields.io/badge/Groq-AI%20SDK-F55036.svg)](https://groq.com/)

**Cosmos** is a WhatsApp Bot framework built with TypeScript, `@whiskeysockets/baileys` v7, the Groq AI SDK, and Prisma ORM on SQLite. It ships an economic simulation with a central banking ledger, AI-underwritten credit loans, career and salary systems, rich media handling, and full English/Indonesian localization.

Live site: <https://cosmos.razael-fox.my.id>

## Features

- **Central Bank** - ACID double-entry ledger, daily transfer limits, interactive transfer confirmation, and daily compound interest.
- **AI-underwritten loans** - LLM risk assessment, credit scoring (0-1000) from 30-day activity, collateral, and asset liquidation on default.
- **Careers and salaries** - Multiple career paths with salaries scaled by the macroeconomic `EconomyMultiplier`, plus shift cooldowns.
- **Virtual identity (KTP)** - Generated identity cards with a verified NIK, gating employment and bank registration.
- **Property market** - Property catalog, portfolio management, and AI broker negotiation for pawning.
- **Localization** - Complete `en` and `id` support with per-user and per-group preferences.
- **Cancellation registry** - A single `.cancel` command aborts any multi-step flow, transfer, or game lobby.
- **Downloaders** - TikTok, YouTube, Pinterest, Telegram (including private channels), Facebook, Twitter/X, and Threads.
- **AI and voice** - Native LLM tool calling, grammar auto-correction, and Whisper speech-to-text.
- **Minigames** - Buckshot Roulette with lobbies and tactical items, slot machine, coinflip, dice, and leaderboards.

## Tech Stack

| Component            | Technology                                     |
| :------------------- | :--------------------------------------------- |
| Package Manager      | [PNPM](https://pnpm.io/)                       |
| Language and Runtime | TypeScript 5.7+ / Node.js ES Modules (>= 20.x) |
| WhatsApp Engine      | `@whiskeysockets/baileys` (v7.0.0-rc14)        |
| Database             | Prisma ORM v7 with `better-sqlite3`            |
| AI                   | Groq SDK, Whisper STT                          |
| Media                | `sharp`, `ffmpeg-static`, `opentype.js`        |
| Telegram             | `telegram` (GramJS)                            |
| i18n                 | `i18next`                                      |
| Logging              | `pino`                                         |

## Prerequisites

- Node.js `>= 20.x`
- PNPM `>= 8.x` (do not use `npm` or `yarn`)
- A Groq API key, for LLM features and speech-to-text

## Installation

```bash
git clone https://github.com/Razael-Fox/cosmos.git
cd cosmos
pnpm install
```

Initialize the database, then pair your WhatsApp account:

```bash
pnpm prisma db push
pnpm prisma generate
pnpm pair
```

`pnpm pair` prompts for the bot device number and pairing method. Enter the resulting 8-digit code in WhatsApp under **Linked Devices > Link a device > Link with phone number instead**, or scan the QR code printed in the terminal.

Alternatively run `pnpm dev` and answer the same prompts interactively. On non-interactive hosts (for example Pterodactyl), set `BOT_PHONE_NUMBER` and `PAIRING_METHOD` in `.env` instead.

To link a Telegram account for media proxying, run `pnpm tgpair`.

## Configuration

Copy `.env.example` to `.env`. The essential keys are:

```env
# Bot device number and privileged owner numbers (comma-separated).
BOT_PHONE_NUMBER="6281234567890"
OWNER_PHONE_NUMBER="6281234567890"

# Pairing method for non-interactive runtimes: code | qr (default: code).
PAIRING_METHOD="code"

# Groq AI (required for LLM features and Whisper STT).
GROQ_API_KEY="gsk_your_groq_api_key_here"
GROQ_MODEL="openai/gpt-oss-20b"

# Database (optional, this is the default).
DATABASE_URL="file:./storage/database.sqlite"
```

Optional integrations include `OPENROUTER_API_KEY`, `EODHD_API_KEY`, and the `TELEGRAM_*` variables. See `.env.example` for the full list. Shop items and economic catalogs are seeded automatically on first startup.

## Running

```bash
pnpm dev           # Development mode via tsx
pnpm build         # Compile to dist/
pnpm start         # Run the compiled build
```

For long-running deployments:

```bash
pnpm pm2:start     # Start under PM2 (recommended)
pnpm pm2:logs      # Stream PM2 logs
pnpm pm2:restart   # Restart the process
pnpm pm2:stop      # Stop the process

pnpm start:bg      # Background nohup daemon (./start.sh)
pnpm status:bg     # Check daemon status
pnpm stop:bg       # Stop the daemon
```

To run as a system service on Linux, use the bundled installer:

```bash
./setup-systemd.sh
sudo systemctl status waf-bot
```

## Commands

All commands use a `.` prefix. Run `.menu [category|all]` for the full in-bot browser or `.help [command]` for detailed syntax.

| Category               | Commands                                                                                                                                                                                                                                                      |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Economy and Banking    | `.bank register`, `.bank balance`, `.bank deposit <amount>`, `.bank withdraw <amount>`, `.bank transfer <to> <amount>`, `.bank statement`, `.loan apply <amount>`, `.loan pay`, `.loan status`, `.loan info`, `.balance`, `.daily`, `.transfer <to> <amount>` |
| Employment             | `.job list`, `.job join <name\|id>`, `.job status`, `.job leave`, `.work`                                                                                                                                                                                     |
| Property and Inventory | `.catalog`, `.buy <id\|name>`, `.sell <id\|name>`, `.pawn <id\|name>`, `.inventory`, `.shop`                                                                                                                                                                  |
| Minigames              | `.roulette creategame <bullets>`, `.roulette joingame`, `.roulette shoot <self\|opponent>`, `.roulette use <item>`, `.slot <bet>`, `.coinflip <bet> <heads\|tails>`, `.dice <bet> <1-6>`, `.top`, `.topglobal`, `.vault`                                      |
| Downloaders            | `.autodl <on\|off>`, `.tiktok <url>`, `.ytdl <url>`, `.pinterest <query\|url>`, `.tgdl <link>`, `.sticker`                                                                                                                                                    |
| AI and Utilities       | `.idcard`, `.apply license`, `.stt`, `.rvo`, `.quoted`, `.getpp [user]`, `.play <query>`                                                                                                                                                                      |
| Settings and System    | `.menu [category\|all]`, `.help [command]`, `.setlang <en\|id>`, `.setgrouplang <en\|id>`, `.cancel`, `.stats`                                                                                                                                                |

## Project Structure

```text
cosmos/
├── assets/                 # Static assets: menu banners, KTP template, fonts
├── bin/                    # Local yt-dlp fallback binary
├── docker/                 # Dockerfiles, nginx, PM2 config, entrypoint
├── docs/                   # Versioning spec, command reference, MCP operator guide (docs/mcp)
├── prisma/schema.prisma    # SQLite schema (User, BankAccount, Loan, Jobs, ...)
├── scripts/
│   ├── admin/              # Operator tools (set balance, merge accounts, subscription check)
│   ├── docker/             # Docker build / deploy / dev helpers
│   ├── i18n/               # Locale sync and validation
│   ├── infra/              # Cloudflare tunnel, Turnstile, Doppler
│   ├── migrations/         # One-off data migrations
│   └── release/            # Version and release automation
├── src/
│   ├── cli/                # Pairing CLIs (WhatsApp, Telegram)
│   ├── db.ts               # Prisma client and better-sqlite3 adapter
│   ├── handlers/           # Message router and command dispatcher
│   ├── index.ts            # Entrypoint and cron scheduler
│   ├── locales/            # Translation dictionaries (en, id)
│   ├── mcp/                # Cosmos MCP server for AI coding agents
│   ├── seeds/              # Item and property catalog seeders
│   ├── services/           # AI, bank, loans, jobs, shop, menu, broadcast, inflation
│   ├── tools/              # Command handlers (group/ and property/ hold command families)
│   └── utils/              # Auto-delete, cancellation, currency, UI, caching, versioning (sticker/ for stickers)
├── storage/                # Runtime state only (databases, sessions, logs, backups)
├── tests/                  # Node test suites
├── version.json            # Canonical version metadata (G-F-P)
├── CHANGELOG.md
└── package.json
```

## Scripts

| Script                                                                    | Purpose                                             |
| :------------------------------------------------------------------------ | :-------------------------------------------------- |
| `pnpm dev`                                                                | Run in development mode                             |
| `pnpm pair` / `pnpm tgpair`                                               | Pair a WhatsApp or Telegram account                 |
| `pnpm build` / `pnpm start`                                               | Compile and run the production build                |
| `pnpm pm2:start` / `pm2:logs` / `pm2:restart` / `pm2:stop`                | Manage the PM2 process                              |
| `pnpm start:bg` / `status:bg` / `stop:bg`                                 | Manage the nohup daemon                             |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`                            | Static checks and formatting                        |
| `pnpm validate:i18n`                                                      | Assert key parity between `en` and `id`             |
| `pnpm mcp:start` / `pnpm mcp:http`                                        | Start the Cosmos MCP server (stdio / loopback HTTP) |
| `pnpm version:show` / `version:check` / `version:verify` / `version:bump` | Inspect, validate, and increment the Cosmos version |
| `pnpm release:pre`                                                        | Publish a tagged release                            |

## Cosmos MCP Server for AI Coding Agents

Cosmos ships a first-party [Model Context Protocol](https://modelcontextprotocol.io) server so
AI coding agents — OpenCode, Claude Code, Pi, and Google Antigravity — can read the database,
inspect the feature catalogue, and perform live bot actions through typed, guarded, audited
tools instead of ad-hoc `npm` installs and throwaway scripts.

```bash
export COSMOS_MCP_TOKEN="..."   # single owner key; the server fails closed without it
pnpm mcp:start                  # stdio transport (local)
pnpm mcp:http                   # Streamable HTTP on 127.0.0.1:4100 (loopback only)
```

```text
"Please broadcast to all groups with a 5-second delay that the bot will be under maintenance."

    -> cosmos_bot_broadcast({ message, delayMs: 5000, dryRun: false, confirm: true })
```

Access is gated behind **exactly one** owner-held API key, every mutation requires a prior
`cosmos_db_mutation_plan` pass, live bot actions return `BOT_OFFLINE` rather than fabricating
data, and the broadcast fan-out is persisted so it survives a restart. See
[`docs/COSMOS_MCP.md`](docs/COSMOS_MCP.md) for the operator guide and
[`docs/mcp/`](docs/mcp/) for per-client configuration.

## Versioning

Cosmos uses its own product-oriented version format instead of SemVer:

```text
G<generation>-F<feature>-P<patch>[.<YYYY-MM-DD>][-<status>]
```

| Component | Meaning                                                                 |
| :-------- | :---------------------------------------------------------------------- |
| `G`       | Generation. Bumped on architectural or schema-level breaks.             |
| `F`       | Feature milestone. Bumped when a major feature is completed.            |
| `P`       | Patch. Bumped for fixes, validation, optimization, and UI improvements. |
| `.date`   | Optional ISO 8601 release date.                                         |
| `status`  | Optional `alpha`, `beta`, `rc1`, or `stable` stage.                     |

So `G2-F24-P7` means generation 2, feature milestone 24, patch 7. The patch
resets to `P0` when a feature milestone is completed, and both reset on a new
generation (`G2-F40-P12` becomes `G3-F1-P0`).

All version metadata is stored in [`version.json`](version.json) at the repository
root so that CI/CD pipelines, the release script, and the runtime can read it
without parsing Markdown or Git tags:

```json
{
    "version": "G2-F24-P7",
    "generation": 2,
    "featureMilestone": 24,
    "patch": 7,
    "releaseDate": "2026-09-30"
}
```

| Script                             | Purpose                                                   |
| :--------------------------------- | :-------------------------------------------------------- |
| `pnpm run version:show`            | Print the current version metadata                        |
| `pnpm run version:check`           | Validate `version.json` and its sync with `package.json`  |
| `pnpm run version:verify`          | Enforce the mandatory update policy against a base commit |
| `pnpm run version:bump patch`      | `G2-F24-P7` to `G2-F24-P8`                                |
| `pnpm run version:bump feature`    | `G2-F24-P7` to `G2-F25-P0`                                |
| `pnpm run version:bump generation` | `G2-F24-P7` to `G3-F1-P0`                                 |
| `pnpm run release:pre`             | Bump, tag, and publish the release                        |

### Mandatory update policy

`version.json` is a version commitment recorded in Git history. Any change that
alters product behaviour must bump the version **in the same commit**:

| Changed path                                                             | Increment    |
| :----------------------------------------------------------------------- | :----------- |
| `src/**`, `prisma/**`, `scripts/**`, `docker/**`, `.github/workflows/**` | `patch`      |
| A completed feature, command, or subsystem ready for use                 | `feature`    |
| Major refactor, major database migration, framework replacement          | `generation` |
| Other `*.md`, `ISSUE.md`, `SUMMARY.md`, formatting, typos, whitespace    | no bump      |

The first row is enforced automatically by the `version-policy` CI job, which
fails when product code changes without a `version.json` update.

See [docs/VERSIONING.md](docs/VERSIONING.md) for the full specification and
[CHANGELOG.md](CHANGELOG.md) for history.

## License

ISC. See [LICENSE](LICENSE).
