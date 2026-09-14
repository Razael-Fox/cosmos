# Changelog

All notable changes to the **Cosmos WhatsApp Bot Framework** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the `RF-YYMM-BUILD` version formatting.

---

## [Unreleased]

---

## [RF-2609-08] - 2026-09-14

### Added

- **Cosmos Sub-Bot Multi-Device Architecture (Jadibot System) (`src/services/subBotService.ts`, `src/tools/subbot.ts`, `tests/subbot.test.ts`):**
    - Autonomous multi-session sub-bot architecture enabling users to link their personal WhatsApp numbers as independent sub-bot instances (`.subbot pair <phone> <code|qr>`).
    - Dual pairing modes supporting 8-digit text pairing codes (120s TTL) and dynamic QR code image generation (60s TTL) using `qrcode`.
    - Integrated pairing cancellation with `.cancel` via `cancellationManager` with in-flight socket cleanup preventing dangling background connections.
    - Anti-recursion protection guard preventing sub-bots from spawning secondary sub-bots.
    - Isolated per-bot directory storage (`database/{phoneNumber}/`) with independent SQLite databases and `config.json`.
    - Programmatic schema DDL bootstrapping (`ensureDatabaseSchema`) for all 23 database models using `better-sqlite3` to guarantee schema integrity in Android Termux / PRoot environments.
    - Baileys lifecycle hardening in `connectionManager.ts`: strictly isolating `process.exit(1)` to `sessionId === 'default'`, allowing sub-bot disconnects and logouts without terminating the parent process.
    - Startup staggered reconnection loop in `src/index.ts` with 3000ms intervals between sub-bot activations.
    - Economic update (FOREX) broadcast suppression based on sub-bot feature configuration.

- **Dynamic Sub-Bot Configuration System (`src/services/subBotConfigService.ts`, `src/tools/config.ts`):**
    - Granular feature toggling for 13 system modules (`casino`, `bank`, `loan`, `jobs`, `shop`, `property`, `downloaders`, `autodl`, `autosticker`, `autocorrection`, `offlineAi`, `forexAnnouncement`, `stt`).
    - Sub-bot operating mode configuration (`public` vs `self` / owner-only mode).
    - Custom bot name, prefix, and default language customization.
    - Hierarchical API key resolution (`src/utils/apiKeyResolver.ts`) resolving custom keys for Groq, OpenRouter, and EODHD with parent environment fallbacks and key fingerprint caching.
    - Credential masking (`gsk_••••••••9aB2`) and public group security alert warnings.
    - 4-tier language resolution hierarchy (`WhitelistedGroup -> User -> SubBot config -> 'id'`).

- **Full Bilingual Localization & Automated Test Suite:**
    - 100% symmetrical translation keys in `src/locales/en/tools.json` and `src/locales/id/tools.json` for sub-bot management and configuration tools.
    - Comprehensive unit & integration test suite in `tests/subbot.test.ts` covering all 8 test cases.
    - New agent skill `subbot-multidevice-architecture` and Rule U in `AGENTS.md`.

---

## [RF-2609-07] - 2026-09-13

### Fixed

- **Cosmos Central Bank Localization & Indonesian Language Support (`src/locales/id/tools.json`, `src/tools/bank.ts`):**
    - Fixed an issue where `.bank deposit` and other central banking commands displayed outputs in English even when the bot language was set to Indonesian (`id`).
    - Translated all 33 banking keys in `src/locales/id/tools.json` into formal, natural Indonesian.
    - Eliminated hardcoded English UI alert and card strings in `src/tools/bank.ts` across `register`, `deposit`, `withdraw`, `transfer`, `balance`/`statement`, and default fallback commands.
    - Added symmetrical i18n keys to `src/locales/en/tools.json` and `src/locales/id/tools.json` for card titles, detail prefixes, and confirmation prompts.
    - Ensured recipient notifications in interactive transfers dynamically resolve the target recipient's chat language rather than echoing the sender's language.

---

## [RF-2609-06] - 2026-09-13

### Added

- **Universal Bot Output Modernization & Cosmos Glass Design System (`src/utils/uiFormatter.ts`, `tests/uiFormatter.test.ts`):**
    - Implemented centralized, decoupled UI rendering engine adhering to the Cosmos Glass & Card Design System (CGDS).
    - Created standardized component APIs: `renderCard` (supporting light, heavy, compact, and bold box-drawing headers), `renderAlert` (for success, warning, error, and informational messages), `renderProgressBar` (Unicode progress indicator `[██████░░░░] 60%`), `renderSyntaxError` (standardized command error card), `renderCatalogCard` (for multi-item catalogs and hall-of-fame podiums), `renderHealthGauge` (for live RPG/minigame HP tracking `❤️❤️❤️🖤🖤 (3/5 HP)`), and `renderBadge`.
    - Comprehensive unit test suite in `tests/uiFormatter.test.ts` verifying all CGDS components and edge cases.
    - Added new localized UI label tokens in `src/locales/en/tools.json` and `src/locales/id/tools.json` with 100% key parity.

### Changed

- **Economy & Casino Command Output Upgrades:**
    - Modernized `.balance` (`src/tools/balance.ts`) into a multi-tiered Financial Identity Card with net worth aggregation and bank account status.
    - Modernized `.daily` (`src/tools/daily.ts`) into a Daily Reward Voucher Card with visual countdown progress bar.
    - Modernized `.slot` (`src/tools/slot.ts`) with a 3-reel framed slot box and jackpot highlight.
    - Modernized `.coinflip` (`src/tools/coinflip.ts`) and `.dice` (`src/tools/dice.ts`) into Arena Match Result Cards.
    - Modernized `.top` (`src/tools/top.ts`) and `.topglobal` (`src/tools/topglobal.ts`) into Casino Hall of Fame Podium Cards using `renderCatalogCard`.
    - Modernized `.vault` (`src/tools/vault.ts`) into a House Vault Statement Card.
    - Modernized `.fevertime` (`src/tools/fevertime.ts`) into a Broadcast Announcement Card with dynamic duration.
    - Modernized `.bank` (`src/tools/bank.ts`) and `.loan` (`src/tools/loan.ts`) with modern passbook, double-entry ledger, and AI credit underwriting cards.
    - Modernized `.job` (`src/tools/job.ts`), `.work` (`src/tools/work.ts`), `.shop` (`src/tools/shop.ts`), `.catalog` (`src/tools/property_catalog.ts`), and `.inventory` (`src/tools/property_inventory.ts`).

- **Minigames, Downloaders & System Diagnostics Upgrades:**
    - Upgraded Buckshot Roulette minigame (`creategame`, `joingame`, `shoot`, `use`) with tactical lobby waiting room HUD cards and live health gauges.
    - Standardized media downloaders (`tiktokdl`, `pinterestdl`, `ytdl`) caption builders to use lightweight metadata cards.
    - Transformed `.stats` / `.system_info` (`src/tools/system_info.ts`) into a comprehensive Server Telemetry Dashboard featuring a live RAM usage progress bar gauge.

---

## [RF-2609-05] - 2026-09-13

### Added

- **Command Description Internationalization (`src/tools/types.ts`, `src/locales/{en,id}/tools.json`):**
    - Enhanced `ToolDefinition` and `NormalizedTool` with optional `descriptionKey` field for explicit translation routing.
    - Added universal `resolveToolDescription(def, t)` helper in `src/tools/types.ts` supporting four-tier fallback resolution:
        1. Explicit `def.descriptionKey`.
        2. Canonical `tools.commands.<clean_name>.description`.
        3. Legacy `tools.<clean_name>.description`.
        4. Default English fallback string (`def.description`).
    - Integrated `descriptionKey: 'tools.commands.<clean_name>.description'` across all 58 bot command definitions in `src/tools/`.
    - Added dedicated `"commands"` section in both `src/locales/en/tools.json` and `src/locales/id/tools.json` with 100% symmetric, bilingual descriptions.
    - Added agent rule **Rule T** (`Standar Menu Bot & Kompatibilitas Deskripsi Perintah i18n`) to `AGENTS.md` and updated `i18n-localization-standards` skill guide.
    - Added unit tests in `tests/menu.test.ts` asserting dynamic command description localization in both English (`en`) and Indonesian (`id`).

### Changed

- **Menu & Help Formatter Integration (`src/utils/menuFormatter.ts`, `src/services/menuService.ts`):**
    - Updated `formatCategoryCommands` and `formatCommandDetail` in `src/utils/menuFormatter.ts` to dynamically resolve command descriptions using the chat/user translator `t`.
    - Added `getToolDescription(tool, t)` method to `MenuService` (`src/services/menuService.ts`).

---

## [RF-2609-04] - 2026-09-12

### Added

- **Modular Menu & Help Architecture (`src/services/menuService.ts`, `src/utils/menuFormatter.ts`, `src/utils/menuAssets.ts`):**
    - High-performance, memoized command reflection and normalization service (`MenuService`).
    - Standardized category consolidation mapping micro-categories into 11 canonical categories with dedicated theme icons (`Casino`, `Games`, `Economy & Banking`, `Employment`, `Downloaders`, `Music & Audio`, `Media & Stickers`, `AI & Correction`, `Tools & Utilities`, `Settings`, `System & Help`).
    - Strict dot prefix normalization (`.`) ensuring all primary commands and aliases render uniformly.
    - Hero banner media loader (`MenuAssets`) with automated placeholder fallback (`assets/menu_banner.placeholder.png`) protecting against corrupt or empty 0-byte remote files.
    - Baileys `externalAdReply` rich preview card with `renderLargerThumbnail: true` for full-width hero header delivery.
    - Standardized user dashboard card displaying pushname, role (Owner/Member), response speed (latency), uptime, date, active language, prefix, and total command count.
    - Multi-mode navigation supporting Category Overview (`.menu`), Category Command List (`.menu <category>`), All-In-One Catalog (`.menu all`), and Single Command Inspector (`.help <command>`).
    - Dedicated standalone `.menu` command entrypoint (`src/tools/menu.ts`).
    - 100% symmetric bilingual localization (`en` and `id`) validated via `validate:i18n`.
    - Comprehensive test suite covering banner fallback, category consolidation, command lookup, inspectors, and Baileys payload dispatch (`tests/menu.test.ts`).

### Changed

- **Refactored Help & Guide Entrypoint (`src/tools/help.ts`):**
    - Transitioned from monolithic category-only listing to multi-intent controller delegating to `MenuService` and `MenuFormatter`.
    - Supports dual inspection: inspecting specific command syntax when a command is queried (`.help <command>`) and category listing when a category is queried (`.help <category>`).
    - Direct socket dispatch with `contextInfo.externalAdReply` returning `undefined` to eliminate command echo in handler pipelines.

---

## [RF-2609-03] - 2026-09-11

### Added

- **Job and Salary Career System (`src/services/jobs.ts`, `src/tools/job.ts`, `src/tools/work.ts`):**
    - Alternative, non-gambling economic progression system allowing users to choose professions and earn dynamic salaries.
    - 6 initial career tracks:
        - **Mining**: Daily shifts with high-variance mineral discoveries (Coal: Rp233.333, Iron: Rp166.666, Gold: Rp333.333, Diamond: Rp666.666). Requires `Pickaxe`.
        - **Office Work**: Stable corporate software development and administration (~Rp250.000/day, Rp7.500.000/month). Requires `MacBook`.
        - **Taxi Driving**: Daily metropolitan passenger transport (~Rp133.333/day, Rp4.000.000/month). Requires `Driver's License`.
        - **Cooking**: Daily restaurant kitchen orders and culinary preparation (~Rp150.000/day, Rp4.500.000/month).
        - **Gojek**: On-demand gig courier and ride-hailing economy (~Rp2.500/delivery + tips) on a 1-hour cooldown.
        - **Entrepreneurship**: Startup enterprise management paying weekly dividends (~Rp1.250.000/week) with market fluctuation cycles (Boom: 1.8x, Normal: 1.0x–1.3x, Sluggish: 0.4x, Deficit: 0). Requires initial investment capital (Rp250.000) and `MacBook` or `iPhone`.
    - Dynamic IDR salary scaling tied to the macroeconomic `EconomyMultiplier` (driven by EODHD exchange rate logs).
    - Strict Virtual ID Card verification gate (`requireIdCard`) preventing users without a registered ID Card from applying or working.
    - ACID double-entry logging recording all salary claims and initial capital investments to `ActivityLog`.
- **Career Management Commands (`src/tools/job.ts`, `src/tools/work.ts`):**
    - `.job list` to browse available professions, requirements, base salaries, and cooldowns.
    - `.job join <JobName|JobID>` to apply or switch jobs using name or numeric ID.
    - `.job status` / `.job info` displaying current position, base salary, shift status, and cooldown timers.
    - `.job leave` / `.job resign` to resign from current employment.
    - `.work` to clock in for shifts, enforce cooldowns, compute dynamic payouts, and output shift narratives using `formatRupiah`.
- **Inventory & Shop Items (`src/seed_item.ts`):**
    - Added `Pickaxe` (`pickaxe`), `MacBook` (`macbook`), `iPhone` (`iphone`), and `Driver's License` (`driver_license`) equipment items to the shop catalog.
- **Driver License Application Integration (`src/tools/apply_license.ts`):**
    - Granted official `Driver's License` equipment item to `UserInventory` upon meeting age requirement (>= 17) and passing the driving test.
- **Database Schema Updates (`prisma/schema.prisma`):**
    - Added `JobCatalog` model tracking jobs, descriptions, base salaries, cooldowns, and required items.
    - Added `currentJobId`, `currentJob`, and `lastWorkedAt` to `User` model.
- **Test Suite (`tests/job.test.ts`):**
    - Comprehensive 10-suite unit and integration test coverage for the Job and Salary System.

### Changed

- Refactored `apply_job.ts` into a feature-complete `.job` command module supporting `.apply-job` aliases.
- Updated bilingual locale dictionaries (`src/locales/en/tools.json`, `src/locales/id/tools.json`) with job and work translation keys.

---

## [RF-2609-02] - 2026-09-11

### Added

- **AI-Underwritten Bank Loan System (`src/services/loanService.ts`, `src/tools/loan.ts`):**
    - AI Credit Risk Underwriting using Groq LLM Native Function Calling (`evaluate_loan_application`) with deterministic offline fallback.
    - Dynamic Credit Scoring algorithm (clamped strictly 0–1000) evaluating 30-day activity logs (`LOAN_REPAYMENT`, `LOAN_DEFAULT`, `CASINO_LOSS`, `CASINO_WIN`, `REAL_ESTATE_PURCHASE`, and Net Worth).
    - 4 Dynamic Credit Tiers: `Poor` (denied), `Fair` (up to Rp15.000.000), `Good` (up to Rp50.000.000), and `Excellent` (up to Rp100.000.000).
    - ACID double-entry disbursement directly into `BankAccount` ledger and repayment support with credit score rehabilitation.
- **Automated Default Penalties & Asset Liquidation:**
    - Automatic account freezing (`status = 'FROZEN'`) upon overdue loan default.
    - Selective asset seizure algorithm (`seizeUserAssetsForDebt`) liquidating owned inventory items and real estate properties (`PropertyCatalog`) ranked by highest value first until debt is satisfied.
    - Status transition to `'Pawned'`, preventing seized assets from being listed in `.inventory` or sold via `.sell`.
    - Automatic account unfreezing once debt is recovered.
- **Scheduled Background Workers & Cron:**
    - Automated 5-day repayment reminder worker (`processLoanReminders`).
    - Hourly background cron (`startLoanSchedulerCron`) checking for defaults and reminders.
- **Multi-Layer Race Condition & Concurrency Defense:**
    - In-flight memory mutexes (`activeAssessments`, `activeDisbursements`, `activeRepayments`) preventing duplicate concurrent API triggers.
    - Strict re-verification inside `prisma.$transaction(async (tx) => ...)` to serialize write transactions and reject parallel disbursements or balance overdrafts.
    - Instant session consumption on `confirm` to prevent re-entrant approvals.
- **Command Interfaces & Interactive Cancellation:**
    - `.loan apply <amount> [collateral]` with 3-minute interactive confirmation window.
    - `.loan pay [amount]` for partial or full repayments.
    - `.loan status` displaying active loan status, principal, interest, due date, and days remaining.
    - `.loan info` displaying credit score, reputation tier, net worth breakdown, and borrow limit.
    - Full integration with global cancellation manager (`.cancel`, `cancel`, `batal`).
- **Database Models (`prisma/schema.prisma`):**
    - `Loan`: Tracks principal, interest rate, due date, status (`ACTIVE`, `PAID`, `DEFAULTED`), and collateral.
    - `ActivityLog`: Comprehensive financial event history.
    - `LoanReminder`: Persistent queue for scheduled 5-day notifications.
    - Added `creditScore` to `User` and `status` (`ACTIVE`, `FROZEN`, `SUSPENDED`) to `BankAccount`.
- **Developer Documentation & Agent Skills:**
    - Added dedicated skill in `.agents/skills/bank-loan-system/SKILL.md`.
    - Added Rule Q to `AGENTS.md`.
    - Complete 10-suite unit test coverage in `tests/loan.test.ts`.

### Fixed

- Fixed race condition vulnerability allowing concurrent double-borrowing when multiple disbursement calls were issued in parallel.
- Fixed potential account balance overdrafts by validating balances directly inside database transactions.

---

## [RF-2609-01] - 2026-09-06

### Added

- **Cosmos Central Bank (CCB) Subsystem (`src/services/bankService.ts`, `src/tools/bank.ts`):**
    - ACID double-entry ledger tracking `BankAccount` and immutable `BankTransaction` audit records with `balanceAfter`.
    - Account registration gate requiring verified Virtual ID Card (`IdCard` / KTP).
    - Deposit (`.bank deposit`), withdrawal (`.bank withdraw`), and interactive transfers (`.bank transfer`).
    - 3-minute interactive transfer confirmation flow with `.cancel` support.
    - Daily transfer limit tracking (default Rp50.000.000) reset daily.
    - Daily compound interest distribution (0.1% per day for balances >= Rp100.000).
- **Virtual Identity Card System (`src/utils/idCard.ts`, `src/tools/idcard.ts`):**
    - Dynamic 16-digit NIK generation and identity card verification.
    - Canvas / Sharp image generation for realistic KTP card previews.
- **Real Estate & Property Catalog (`src/tools/property_buy.ts`, `src/tools/property_sell.ts`, `src/tools/property_inventory.ts`):**
    - Purchasing and owning properties from `PropertyCatalog`.
    - AI broker negotiation system via Groq LLM for pawning/selling properties.
    - Deterministic catalog ordering and inventory asset valuation.
- **Multilingual Localization & Internationalization (i18n):**
    - Full English (`en`) and Indonesian (`id`) locale files across all tools and messages.
    - Build script asset synchronization (`scripts/copy-locales.ts`).
- **Standardized Currency Formatting:**
    - Indonesian Rupiah standard (`formatRupiah`, `parseCurrencyAmount` in `src/utils/currency.ts`).

### Changed

- Complete framework rebranding from WAF to **Cosmos WhatsApp Bot Framework**.
- Upgraded Groq model configuration to utilize dynamic `GROQ_MODEL` environment variable.
- Improved property selling syntax to support prefix matching and ID-based buying/selling.

### Fixed

- Fixed JID vs LID mismatch by deduplicating users and linking identifiers in user queries.
- Fixed currency parsing with decimal abbreviations (e.g., `1.5jt`, `500k`, `Rp10.000`).
- Downgraded `better-sqlite3` to fix build and compilation issues on Node.js 24 environments.

---

## [RF-2608-01] - 2026-08-15 (Beta)

### Added

- Initial Baileys v7 integration for WhatsApp Web API.
- Casino minigames: Buckshot Roulette, Slot machine, Dice.
- Media handling: sticker maker, YouTube downloader, TikTok downloader, Pinterest downloader.
- Speech-to-text integration using Groq Whisper.
- Auto-sticker and auto-downloading features.
- SQLite persistence with Prisma ORM.

---

## Source Code Architecture

Below is the directory architecture of the Cosmos WhatsApp Bot codebase:

```text
cosmos/
├── .agents/skills/            # Agent guidelines and specialized engineering skills
│   ├── bank-loan-system/      # Bank loan system underwriting, credit & seizure rules
│   ├── cosmos-central-bank/   # CCB double-entry ledger & transfer rules
│   ├── global-cancellation/   # Cancellation manager standards (.cancel)
│   └── ...
├── prisma/
│   └── schema.prisma          # Database schema (User, BankAccount, Loan, etc.)
├── scripts/
│   └── copy-locales.ts        # Locale synchronization during compilation
├── src/
│   ├── generated/             # Generated Prisma client
│   ├── handlers/
│   │   └── message.ts         # High-level message router & command dispatcher
│   ├── locales/               # Multilingual JSON dictionary (en, id)
│   ├── services/
│   │   ├── bankService.ts     # Central Bank transactions, limits & interest
│   │   ├── jobs.ts            # Career catalog, salary calculations & cooldowns
│   │   ├── loanService.ts     # Loan underwriting, credit score & asset seizure
│   │   └── shopService.ts     # Item store and purchasing service
│   ├── tools/
│   │   ├── bank.ts            # .bank command handler
│   │   ├── job.ts             # .job career management command handler
│   │   ├── loan.ts            # .loan command handler
│   │   ├── property_buy.ts    # .buy property handler
│   │   ├── property_sell.ts   # .sell / .pawn property handler
│   │   ├── work.ts            # .work shift execution handler
│   │   └── ...
│   ├── utils/
│   │   ├── cancellationManager.ts # Global .cancel interactive registry
│   │   ├── casino.ts          # JID/LID matching & mention formatting
│   │   ├── currency.ts        # Indonesian Rupiah formatting & parsing
│   │   └── idCard.ts          # Virtual ID Card / KTP verification
│   └── index.ts               # Application entrypoint & cron scheduler startup
├── tests/
│   ├── bank.test.ts           # Central Bank test suite (9 tests)
│   ├── job.test.ts            # Job and Salary System test suite (10 tests)
│   └── loan.test.ts           # Bank Loan System test suite (10 tests)
├── AGENTS.md                  # Mandatory AI Agent rules and regulations
└── package.json               # NPM workspace scripts and dependencies
```

---

## Core Data Models

```prisma
model User {
  id             String       @id // WA JID (e.g. 628123456789@s.whatsapp.net)
  lid            String?      @unique // WhatsApp Local Identifier (LID)
  pushName       String?
  balance        BigInt       @default(10000)
  creditScore    Int          @default(500)
  currentJobId   Int?
  currentJob     JobCatalog?  @relation(fields: [currentJobId], references: [id], onDelete: SetNull)
  lastWorkedAt   DateTime?
  bankAccount    BankAccount?
  loans          Loan[]
  activities     ActivityLog[]
  inventories    UserInventory[]
}

model JobCatalog {
  id              Int     @id @default(autoincrement())
  name            String  @unique // e.g., 'Mining', 'Office Work'
  description     String
  baseSalary      BigInt  // Base payout before economy multiplier
  cooldownMinutes Int     @default(60)
  requiredItemId  String? // Links to an Item.id or shortId (e.g., Pickaxe, MacBook)
  isActive        Boolean @default(true)
  workers         User[]
}

model BankAccount {
  accountNumber String   @id
  userJid       String   @unique
  balance       BigInt   @default(0)
  status        String   @default("ACTIVE") // ACTIVE, FROZEN, SUSPENDED
  transactions  BankTransaction[]
}

model Loan {
  id              String         @id @default(uuid())
  userId          String
  principalAmount BigInt
  interestRate    Float
  dueDate         DateTime
  status          String         @default("ACTIVE") // ACTIVE, PAID, DEFAULTED
  collateralItems String?
  reminders       LoanReminder[]
}
```

[Unreleased]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-07...HEAD
[RF-2609-07]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-06...RF-2609-07
[RF-2609-06]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-05...RF-2609-06
[RF-2609-05]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-04...RF-2609-05
[RF-2609-04]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-03...RF-2609-04
[RF-2609-03]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-02...RF-2609-03
[RF-2609-02]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-01...RF-2609-02
[RF-2609-01]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2608-01...RF-2609-01
[RF-2608-01]: https://github.com/razaelmahasaputra/cosmos/releases/tag/RF-2608-01
