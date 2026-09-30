# Cosmos - WhatsApp Bot Framework

[![Version](https://img.shields.io/badge/version-RF--2609--21-blue.svg)](CHANGELOG.md)
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
├── assets/                 # Menu banners, placeholders, fonts
├── prisma/schema.prisma    # SQLite schema (User, BankAccount, Loan, Jobs, ...)
├── scripts/                # Locale sync, release automation, i18n validation
├── src/
│   ├── db.ts               # Prisma client and better-sqlite3 adapter
│   ├── index.ts            # Entrypoint and cron scheduler
│   ├── handlers/           # Message router and command dispatcher
│   ├── locales/            # Translation dictionaries (en, id)
│   ├── services/           # AI, bank, loans, jobs, shop, menu, inflation
│   ├── tools/              # Command handlers
│   └── utils/              # Auto-delete, cancellation, currency, UI, caching
├── tests/                  # Vitest test suites
├── CHANGELOG.md
└── package.json
```

## Scripts

| Script                                                     | Purpose                                 |
| :--------------------------------------------------------- | :-------------------------------------- |
| `pnpm dev`                                                 | Run in development mode                 |
| `pnpm pair` / `pnpm tgpair`                                | Pair a WhatsApp or Telegram account     |
| `pnpm build` / `pnpm start`                                | Compile and run the production build    |
| `pnpm pm2:start` / `pm2:logs` / `pm2:restart` / `pm2:stop` | Manage the PM2 process                  |
| `pnpm start:bg` / `status:bg` / `stop:bg`                  | Manage the nohup daemon                 |
| `pnpm typecheck` / `pnpm lint` / `pnpm format`             | Static checks and formatting            |
| `pnpm validate:i18n`                                       | Assert key parity between `en` and `id` |
| `pnpm release:pre`                                         | Publish a tagged pre-release            |

## Versioning

Pre-releases use the `RF-YYMM-BUILD` convention (for example `RF-2609-21`). Stable releases follow SemVer (`1.0.0`, tagged `v1.0.0`). See [CHANGELOG.md](CHANGELOG.md) for history.

## License

ISC. See [LICENSE](LICENSE).
