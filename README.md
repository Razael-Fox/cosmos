# 🚀 Cosmos - WhatsApp Bot Framework

[![Version](https://img.shields.io/badge/version-RF--2609--07-blue.svg)](CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x%20|%2022.x%20|%2024.x-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PNPM](https://img.shields.io/badge/PNPM-8.x+-F69220.svg?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Baileys](https://img.shields.io/badge/Baileys-v7.0.0--rc14-25D366.svg?logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Prisma](https://img.shields.io/badge/Prisma-v7.9+-2D3748.svg?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Groq AI](https://img.shields.io/badge/Groq-AI%20SDK-F55036.svg)](https://groq.com/)
[![License](https://img.shields.io/badge/License-ISC-green.svg)](LICENSE)

**Cosmos** is a modern, enterprise-grade WhatsApp Bot framework built with **TypeScript**, **@whiskeysockets/baileys v7**, **Groq AI SDK**, and **Prisma ORM (SQLite)**. It features an advanced economic simulation, central banking ledger, AI-underwritten credit loans, career pathways, rich media handling, and full bilingual localization.

---

## 🌟 Key Features

- ⚡ **TypeScript & ESM Native:** Built with strict TypeScript under native ES Modules (`type: "module"`), ensuring high maintainability and type safety.
- 🏦 **Cosmos Central Bank (CCB):** ACID-compliant double-entry banking ledger with immutable transaction logs, daily transfer limits, interactive 3-minute transfer confirmation flows, and daily compound interest (0.1%/day).
- 💳 **AI-Underwritten Bank Loan System:** Groq LLM Native Function Calling risk underwriting, dynamic credit scoring (0–1000) based on 30-day activity, 4 credit tiers, collateral management, automated debt reminders, and default asset liquidation.
- 💼 **Career & Dynamic Salary System:** 6 career paths (Mining, Office Work, Taxi Driving, Culinary, Gojek, Entrepreneurship) with dynamic IDR salaries tied to macroeconomic exchange rate trends (`EconomyMultiplier`), equipment prerequisites, and shift cooldowns.
- 🆔 **Virtual Identity Card (KTP):** Realistic visual identity card generation via Sharp with verified 16-digit NIK, gating civic employment and banking registration.
- 🏠 **Real Estate & Property Market:** Property acquisition catalog, portfolio management, and interactive AI broker negotiations for property pawning and liquidation.
- 🎨 **Cosmos Glass Design System (CGDS):** Universal UI rendering engine providing structured card frames, Unicode progress bars, badges, health gauges, and visual telemetry dashboards.
- 📜 **Modular Menu & Help System:** Categorized menu navigation (`.menu`, `.help`), Baileys `externalAdReply` rich banner cards with `renderLargerThumbnail`, and symmetric bilingual command descriptions.
- 🌐 **Full Multilingual Localization (i18n):** Complete English (`en`) and Indonesian (`id`) language support with dynamic per-user and per-group preferences (`.setlang`, `.setgrouplang`).
- 🛑 **Global Cancellation System (`.cancel`):** Unified conversational cancellation registry for multi-step flows, transfers, loan applications, and game lobbies.
- 📥 **Advanced Multi-Platform Downloaders:** Automated link interceptor and manual downloaders for TikTok, YouTube (Audio/Video), Pinterest, Telegram (with private channel proxying), Facebook, Twitter/X, and Threads.
- 🕒 **Persistent Auto-Delete Service:** SQLite-backed `ScheduledDeletion` queue preserving chat cleanliness and admin privileges across bot restarts.
- 🤖 **Groq AI & Voice Intelligence:** Native LLM tool calling, grammar auto-correction, and Groq Whisper Speech-to-Text audio transcription.
- 🎰 **Casino & Tactical Minigames:** Buckshot Roulette (tactical items, lobby waiting rooms, and live health gauges), Slot Machine, Coinflip, Dice, House Vault, and global leaderboards.
- 🔄 **Production Process Management:** Native support for PM2, Linux Systemd daemon (`waf-bot.service`), and background nohup scripts.

---

## 🛠️ Tech Stack

| Component                    | Technology                                                   |
| :--------------------------- | :----------------------------------------------------------- |
| **Package Manager**          | [PNPM](https://pnpm.io/) (`pnpm-lock.yaml`)                  |
| **Language & Runtime**       | TypeScript 5.7+ / Node.js ES Modules (Node >= 20.x)          |
| **WhatsApp Engine**          | `@whiskeysockets/baileys` (v7.0.0-rc14)                      |
| **Database & ORM**           | Prisma ORM v7 (`@prisma/client` + `better-sqlite3`)          |
| **AI STT & LLM**             | Groq SDK (`groq-sdk`), Whisper STT                           |
| **Image & Media Processing** | `sharp`, `@img/sharp-wasm32`, `ffmpeg-static`, `opentype.js` |
| **Telegram Client**          | `telegram` (GramJS)                                          |
| **Localization (i18n)**      | `i18next`, `i18next-fs-backend`                              |
| **Process Management**       | PM2, Systemd, Nohup scripts                                  |
| **Logging**                  | `pino`                                                       |

---

## 📋 Prerequisites

- **Node.js** `>= 20.x` (Tested on Node `v22.x` and `v24.x`)
- **PNPM** `>= 8.x` (_Do NOT use `npm` or `yarn`_)
- **Groq API Key** (Required for LLM features and Whisper STT)
- **FFmpeg** (Bundled via `ffmpeg-static` optional dependency or system binary)

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory:

```env
# ==========================================
# WhatsApp Bot Configuration (Required)
# ==========================================
# Bot device number (optional fallback for non-interactive runtimes).
# On interactive startup with no registered session, the bot prompts for this number.
BOT_PHONE_NUMBER="6281234567890"

# Privileged owner numbers (comma-separated for multiple owners).
# Owner-gated commands succeed only from these numbers or the bot device itself.
OWNER_PHONE_NUMBER="6281234567890"

# Pairing method for non-interactive runtimes: code | qr (default: code).
PAIRING_METHOD="code"

# ==========================================
# Groq AI Configuration (Required)
# ==========================================
GROQ_API_KEY="gsk_your_groq_api_key_here"
GROQ_MODEL="openai/gpt-oss-20b"

# ==========================================
# Database Configuration (Optional)
# ==========================================
DATABASE_URL="file:./storage/database.sqlite"

# ==========================================
# Optional Integrations
# ==========================================
# Grammar Auto-Correction & AI Utilities
OPENROUTER_API_KEY=""

# Macroeconomic Exchange Rate API (EODHD)
EODHD_API_KEY=""

# Telegram Media Proxying (Optional)
TELEGRAM_API_ID=""
TELEGRAM_API_HASH=""

# Automated Database Backup via Telegram Bot
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
```

---

## 🗄️ Database Setup (Prisma)

Initialize the SQLite database schema using Prisma:

```bash
pnpm prisma db push
pnpm prisma generate
```

_Note: Initial shop items and economic catalogs are seeded automatically on first startup._

---

## 🚀 Quick Start & Installation

### 1. Clone & Install Dependencies

```bash
git clone git@github.com:razaelmahasaputra/cosmos.git
cd cosmos
pnpm install
```

### 2. Verify Types & Build

```bash
pnpm typecheck
pnpm build
```

### 3. Pair Your WhatsApp Account

Before starting the bot for the first time, pair your WhatsApp account to generate the authentication credentials:

```bash
pnpm pair
```

You will be prompted for the bot device number and the pairing method (pairing code or QR code).
Enter the 8-digit pairing code in your WhatsApp app (**Linked Devices > Link a device > Link with phone number instead**),
or scan the QR code rendered in the terminal.

Alternatively, start the bot directly; when no registered session exists it prompts for the same values:

```bash
pnpm dev
```

```
[System] Checking default session credentials...
[System] No registered session found. Pairing is required.
Enter the bot WhatsApp number (country code without + or spaces, e.g. 628123456789):
Select the pairing method:
  1) Pairing code (8-digit code entered in WhatsApp > Linked Devices)
  2) QR code (scan from terminal)
Enter choice [1/2] (default: 1):
```

When a registered session already exists, the bot connects silently without any prompt.
For non-interactive hosts without stdin (for example Pterodactyl), set `BOT_PHONE_NUMBER` and `PAIRING_METHOD` in `.env`
and grant privileges via `OWNER_PHONE_NUMBER` (comma-separated for multiple owners).

_(Optional)_ If you plan to proxy media from Telegram channels, link your Telegram account as well:

```bash
pnpm tgpair
```

---

## 🏃 Running the Bot

Choose one of the following execution methods based on your environment:

### 🟢 1. Development Mode (Local Testing)

Runs the application directly using `tsx`:

```bash
pnpm dev
```

### 🔵 2. Production Mode (Compiled JS)

Runs the compiled JavaScript build (`dist/index.js`):

```bash
pnpm build
pnpm start
```

### ⚡ 3. PM2 Process Manager (Recommended for Production)

Manage the bot process using PM2:

```bash
# Start bot process
pnpm pm2:start

# View live output logs
pnpm pm2:logs

# Restart bot process
pnpm pm2:restart

# Stop bot process
pnpm pm2:stop
```

### 🟣 4. Background Daemon Mode (Nohup)

Runs the bot in the background using standalone shell scripts:

```bash
# Start background daemon
pnpm start:bg   # or ./start.sh

# Check daemon status
pnpm status:bg  # or ./status.sh

# View daemon logs
tail -f bot_output.log

# Stop background daemon
pnpm stop:bg    # or ./stop.sh
```

### 🐧 5. Linux Systemd Daemon Service

To configure the bot as a system service on Linux (Ubuntu/Debian):

```bash
# Run the automated installer
./setup-systemd.sh

# Manage the service
sudo systemctl status waf-bot
sudo systemctl start waf-bot
sudo systemctl stop waf-bot
sudo systemctl restart waf-bot

# View realtime systemd logs
sudo journalctl -u waf-bot -f
```

---

## 📖 Command Reference

Cosmos uses a standard dot prefix (`.`) for all bot commands.

### 💰 Economy, Banking & Loans

| Command                             | Description                                                            |
| :---------------------------------- | :--------------------------------------------------------------------- |
| `.bank register`                    | Open a Cosmos Central Bank savings account (requires Virtual ID Card). |
| `.bank balance`                     | Check bank balance, account number, and interest accrued.              |
| `.bank deposit <amount>`            | Deposit funds from wallet into savings account.                        |
| `.bank withdraw <amount>`           | Withdraw funds from savings account into wallet.                       |
| `.bank transfer <to> <amount>`      | Transfer funds with an interactive 3-minute confirmation window.       |
| `.bank statement`                   | View recent bank transaction history and mutations.                    |
| `.loan apply <amount> [collateral]` | Apply for an AI-underwritten credit loan.                              |
| `.loan pay [amount]`                | Make partial or full loan repayments.                                  |
| `.loan status`                      | Check active loan terms, remaining principal, and due date.            |
| `.loan info`                        | Inspect credit score (0–1000), reputation tier, and borrowing limit.   |
| `.balance`                          | View financial identity card, net worth, wallet, and bank balances.    |
| `.daily`                            | Claim daily reward voucher with streak tracking.                       |
| `.transfer <to> <amount>`           | Direct peer-to-peer wallet transfer.                                   |

### 💼 Employment & Careers

| Command                | Description                                                              |
| :--------------------- | :----------------------------------------------------------------------- |
| `.job list`            | Browse available careers, base salaries, cooldowns, and prerequisites.   |
| `.job join <name\|id>` | Apply for and join a career track (requires Virtual ID Card).            |
| `.job status`          | View employment status, active profession, and shift readiness.          |
| `.job leave`           | Resign from current profession.                                          |
| `.work`                | Clock in for a shift to earn salary scaled by macroeconomic multipliers. |

### 🏠 Real Estate & Inventory

| Command            | Description                                              |
| :----------------- | :------------------------------------------------------- |
| `.catalog`         | Browse available properties and real estate assets.      |
| `.buy <id\|name>`  | Purchase real estate properties or store items.          |
| `.sell <id\|name>` | Sell properties or items to market buyers.               |
| `.pawn <id\|name>` | Pawn properties through AI broker negotiations.          |
| `.inventory`       | View owned items, equipment, and real estate properties. |
| `.shop`            | View purchasable equipment, tools, and consumables.      |

### 🎰 Casino & Minigames

| Command                            | Description                                                       |
| :--------------------------------- | :---------------------------------------------------------------- |
| `.roulette creategame <bullets>`   | Create a tactical Buckshot Roulette game lobby.                   |
| `.roulette joingame`               | Join an open Buckshot Roulette match.                             |
| `.roulette startgame`              | Start the match and load shells into the chamber.                 |
| `.roulette shoot <self\|opponent>` | Shoot yourself or your opponent.                                  |
| `.roulette use <item>`             | Use tactical items (Beer, Saw, Cigarettes, Handcuffs, Magnifier). |
| `.roulette bet <amount>`           | Place a wager on the roulette lobby.                              |
| `.slot <bet>`                      | Spin the 3-reel slot machine for jackpot multipliers.             |
| `.coinflip <bet> <heads\|tails>`   | Wager on coin flip arena matches.                                 |
| `.dice <bet> <1-6>`                | Roll dice in high-stakes casino games.                            |
| `.top`                             | View group casino wealth leaderboards.                            |
| `.topglobal`                       | View global wealth leaderboards across all groups.                |
| `.vault`                           | Inspect Cosmos Central Bank vault reserves and house liquidity.   |
| `.fevertime`                       | Broadcast active casino fever bonus events.                       |

### 📥 Downloaders & Media

| Command                     | Description                                                 |
| :-------------------------- | :---------------------------------------------------------- |
| `.autodl <on\|off\|status>` | Toggle automatic media downloader URL interceptor.          |
| `.tiktok <url>`             | Download TikTok videos or photo slides without watermarks.  |
| `.ytdl <url>`               | Download YouTube videos or audio streams.                   |
| `.pinterest <query\|url>`   | Search Pinterest pins or download media links directly.     |
| `.tgdl <link>`              | Download media from public or private Telegram posts.       |
| `.sticker`                  | Convert images or short videos/GIFs into WhatsApp stickers. |

### 🎵 Music & Audio

| Command         | Description                                              |
| :-------------- | :------------------------------------------------------- |
| `.play <query>` | Search, download, and stream audio tracks with metadata. |

### 🤖 AI, Civics & Utilities

| Command                 | Description                                                  |
| :---------------------- | :----------------------------------------------------------- |
| `.idcard`               | Generate or inspect official Virtual Identity Card (KTP).    |
| `.apply license`        | Take driving examination to obtain Driver's License.         |
| `.stt`                  | Transcribe voice notes and audio into text via Groq Whisper. |
| `.rvo`                  | Read and inspect View-Once media messages.                   |
| `.quoted`               | Fetch and quote replied-to messages.                         |
| `.getpp [user]`         | Retrieve full-resolution profile pictures.                   |
| `.toggleofflineai`      | Toggle local AI conversation mode for private/group chats.   |
| `.toggleautocorrection` | Toggle dynamic text grammar auto-correction.                 |

### ⚙️ Settings & System

| Command                  | Description                                                   |
| :----------------------- | :------------------------------------------------------------ |
| `.menu [category\|all]`  | Open the categorized hero menu dashboard.                     |
| `.help [command]`        | Display detailed syntax, usage examples, and aliases.         |
| `.setlang <en\|id>`      | Set personal language preference.                             |
| `.setgrouplang <en\|id>` | Set group-wide language preference (Admin only).              |
| `.cancel`                | Abort any active multi-step session, transfer, or game lobby. |
| `.stats`                 | View server telemetry, RAM gauges, latency, and uptime.       |

---

## 📁 Directory Structure

```text
cosmos/
├── .agents/skills/            # Agent guidelines and domain specifications
├── assets/                    # Static assets (menu banners, placeholders, fonts)
├── prisma/
│   └── schema.prisma          # SQLite schema (User, BankAccount, Loan, Jobs, etc.)
├── scripts/
│   ├── copy-locales.ts        # Syncs translation JSON files during build
│   ├── release.ts             # Pre-release tag and GitHub release automation
│   └── validate-i18n.ts       # Validates 100% key parity between locales
├── src/
│   ├── db.ts                  # Prisma client with Better-SQLite3 driver adapter
│   ├── index.ts               # Application entrypoint & cron scheduler startup
│   ├── logger.ts              # Pino logger configuration
│   ├── pair.ts                # WhatsApp pairing code authentication script
│   ├── tgpair.ts              # Telegram client pairing authentication script
│   ├── handlers/
│   │   ├── message.ts         # Central message router & command dispatcher
│   │   └── ...
│   ├── locales/               # Multilingual JSON dictionaries
│   │   ├── en/                # English translations
│   │   └── id/                # Indonesian translations
│   ├── services/
│   │   ├── ai.ts              # Groq LLM integration
│   │   ├── bankService.ts     # Central Bank transactions, limits & interest
│   │   ├── inflation.ts       # Macroeconomic exchange rate tracker
│   │   ├── jobs.ts            # Career catalog, dynamic salaries & cooldowns
│   │   ├── loanService.ts     # AI credit underwriting, loans & asset liquidation
│   │   ├── menuService.ts     # Menu normalization & category reflection
│   │   └── shopService.ts     # Store catalog & item purchasing
│   ├── tools/                 # 58+ Modular command handlers
│   └── utils/
│       ├── autoDelete.ts      # Persistent DB-backed media cleanup service
│       ├── autodl.ts          # Auto-downloader URL interceptor & queue
│       ├── cancellationManager.ts # Global .cancel interactive registry
│       ├── casino.ts          # JID/LID matching & mention formatting
│       ├── currency.ts        # Indonesian Rupiah formatting (formatRupiah)
│       ├── idCard.ts          # Virtual ID Card / KTP image generator
│       ├── menuFormatter.ts   # Rich menu renderer & Baileys banner generator
│       ├── messageCache.ts    # Message deduplication cache
│       ├── telegramClient.ts  # GramJS Telegram proxy client
│       └── uiFormatter.ts     # Cosmos Glass Design System (CGDS) renderer
├── tests/                     # Vitest / TypeScript unit & integration test suites
├── CHANGELOG.md               # Version history and release notes
├── ecosystem.config.cjs       # PM2 process configuration
├── waf-bot.service            # Linux Systemd unit configuration
└── package.json               # PNPM project configuration and scripts
```

---

## 📜 Available PNPM Scripts

| Script               | Purpose                                                      |
| :------------------- | :----------------------------------------------------------- |
| `pnpm dev`           | Runs the bot in development mode using `tsx`                 |
| `pnpm pair`          | Requests an 8-digit WhatsApp pairing code                    |
| `pnpm tgpair`        | Links a Telegram account for media proxying                  |
| `pnpm build`         | Compiles TypeScript and synchronizes locale assets           |
| `pnpm start`         | Runs the compiled JavaScript build (`dist/index.js`)         |
| `pnpm pm2:start`     | Launches the bot under PM2 supervision                       |
| `pnpm pm2:logs`      | Streams live PM2 log outputs                                 |
| `pnpm pm2:restart`   | Gracefully restarts the PM2 process                          |
| `pnpm pm2:stop`      | Stops the PM2 process                                        |
| `pnpm start:bg`      | Starts the bot as a background nohup daemon                  |
| `pnpm status:bg`     | Checks background nohup daemon status                        |
| `pnpm stop:bg`       | Stops the background nohup daemon                            |
| `pnpm typecheck`     | Checks TypeScript compilation without writing output         |
| `pnpm lint`          | Runs ESLint code quality checks                              |
| `pnpm format`        | Formats all files across the repository with Prettier        |
| `pnpm validate:i18n` | Asserts symmetrical key parity between `en` and `id` locales |
| `pnpm release:pre`   | Prepares and publishes a tagged pre-release on GitHub        |

---

## 🏷️ Versioning Standard

Cosmos adheres strictly to the **`RF-YYMM-BUILD`** release versioning convention (e.g., `RF-2609-07`).
For detailed release history, refer to [CHANGELOG.md](CHANGELOG.md).

---

## ⚖️ License

Distributed under the **ISC License**. See `LICENSE` for more information.
