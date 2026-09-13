# [RFC / Implementation] Cosmos Universal Bot Output Modernization & Design System

- **Target Version:** `RF-2609-06`
- **Issue Reference:** [#14](https://github.com/razaelmahasaputra/cosmos/issues/14)
- **Component:** Core UX / Cosmos Glass Design System (CGDS)
- **Status:** Completed & Verified
- **Related Files:**
  - [`src/utils/uiFormatter.ts`](file:///home/admin/cosmos/src/utils/uiFormatter.ts) (Central Decoupled UI Presentation Engine)
  - [`tests/uiFormatter.test.ts`](file:///home/admin/cosmos/tests/uiFormatter.test.ts) (Design System Unit Test Suite)
  - [`src/tools/balance.ts`](file:///home/admin/cosmos/src/tools/balance.ts)
  - [`src/tools/daily.ts`](file:///home/admin/cosmos/src/tools/daily.ts)
  - [`src/tools/slot.ts`](file:///home/admin/cosmos/src/tools/slot.ts)
  - [`src/tools/coinflip.ts`](file:///home/admin/cosmos/src/tools/coinflip.ts)
  - [`src/tools/dice.ts`](file:///home/admin/cosmos/src/tools/dice.ts)
  - [`src/tools/top.ts`](file:///home/admin/cosmos/src/tools/top.ts)
  - [`src/tools/topglobal.ts`](file:///home/admin/cosmos/src/tools/topglobal.ts)
  - [`src/tools/vault.ts`](file:///home/admin/cosmos/src/tools/vault.ts)
  - [`src/tools/fevertime.ts`](file:///home/admin/cosmos/src/tools/fevertime.ts)
  - [`src/tools/bank.ts`](file:///home/admin/cosmos/src/tools/bank.ts)
  - [`src/tools/loan.ts`](file:///home/admin/cosmos/src/tools/loan.ts)
  - [`src/tools/work.ts`](file:///home/admin/cosmos/src/tools/work.ts)
  - [`src/tools/job.ts`](file:///home/admin/cosmos/src/tools/job.ts)
  - [`src/tools/shop.ts`](file:///home/admin/cosmos/src/tools/shop.ts)
  - [`src/tools/property_catalog.ts`](file:///home/admin/cosmos/src/tools/property_catalog.ts)
  - [`src/tools/property_inventory.ts`](file:///home/admin/cosmos/src/tools/property_inventory.ts)
  - [`src/tools/roulette_creategame.ts`](file:///home/admin/cosmos/src/tools/roulette_creategame.ts)
  - [`src/tools/roulette_joingame.ts`](file:///home/admin/cosmos/src/tools/roulette_joingame.ts)
  - [`src/tools/roulette_shoot.ts`](file:///home/admin/cosmos/src/tools/roulette_shoot.ts)
  - [`src/tools/roulette_use.ts`](file:///home/admin/cosmos/src/tools/roulette_use.ts)
  - [`src/utils/roulette.ts`](file:///home/admin/cosmos/src/utils/roulette.ts)
  - [`src/tools/tiktokdl.ts`](file:///home/admin/cosmos/src/tools/tiktokdl.ts)
  - [`src/tools/pinterestdl.ts`](file:///home/admin/cosmos/src/tools/pinterestdl.ts)
  - [`src/tools/ytdl.ts`](file:///home/admin/cosmos/src/tools/ytdl.ts)
  - [`src/tools/system_info.ts`](file:///home/admin/cosmos/src/tools/system_info.ts)
  - [`src/tools/idcard.ts`](file:///home/admin/cosmos/src/tools/idcard.ts)
  - [`src/locales/en/tools.json`](file:///home/admin/cosmos/src/locales/en/tools.json)
  - [`src/locales/id/tools.json`](file:///home/admin/cosmos/src/locales/id/tools.json)

---

## 1. Problem Statement & Background

Prior to this implementation, command outputs across the Cosmos bot framework had drifted into visual inconsistency:
1. **Legacy ASCII Borders:** Commands used archaic dividers (`=== [ Cosmos Central Bank ] ===` or `=== [ FEVER TIME ] ===`) conflicting with the modern Glass & Card aesthetic established in `RF-2609-04` / `RF-2609-05`.
2. **Duplicated Formatting Logic:** Every command manually built box strings, leading to inconsistent borders (`╭───`, `│`, `╰───`), uneven spacing, and broken multi-line paddings.
3. **Hardcoded Strings:** Several economy and gaming tools contained hardcoded English text mixed with Indonesian translations.
4. **Visual Blandness:** Missing visual gauges (progress bars, health meters, status badges) for shift cooldowns, daily rewards, roulette lives, and server telemetry.

---

## 2. Architecture & Design

### A. Central Decoupled UI Presentation Layer (`src/utils/uiFormatter.ts`)

A dedicated formatting library providing reusable, type-safe visual components:

- **`renderCard(options: CardOptions)`**: Box-drawing cards with support for `light` (`╭───「`, `│`, `╰───`), `heavy` / `bold` (`╭━━━〔`, `┃`, `╰━━━`), and `compact` (`┌──「`, `│`, `└──`) border styles, subtitles, section groups, item lists, footers, and tip callouts.
- **`renderAlert(options: AlertOptions)`**: Standardized notifications for `success`, `warning`, `error`, and `info` with action suggestions.
- **`renderProgressBar(options: ProgressOptions)`**: Visual Unicode progress bars (`[██████░░░░] 60%`).
- **`renderHealthGauge(current: number, max: number)`**: Health bar meters for combat/minigame HP tracking (`❤️❤️❤️🖤🖤 (3/5 HP)`).
- **`renderCatalogCard(title, icon, items, footerTip)`**: Multi-item catalog and leaderboard podium displays.
- **`renderSyntaxError(command, desc, usage, example, t)`**: Standardized error cards guiding users with correct syntax and examples.
- **`renderBadge(text)`**: Unicode capsule badges (`[ TEXT ]`).

### B. Command Modernization Across All Domains

1. **Economy & Banking**:
   - `.balance`: Modern Financial Identity Card with net worth tiers and bank account status.
   - `.daily`: Modern Daily Reward Voucher Card with cooldown countdown progress bar.
   - `.bank`: Passbook statement cards, double-entry transaction ledgers, interactive transfer confirmation dialogs.
   - `.loan`: AI Underwriting assessment reports, credit profile gauges, and disbursement notifications.
   - `.shop`, `.catalog`, `.inventory`: Structured digital inventory vault and property catalog cards.
   - `.job`, `.work`: Career directory cards and shift completion vouchers with dynamic macroeconomic multipliers.

2. **Casino & Games**:
   - `.slot`: 3-reel framed slot machine box with jackpot highlight.
   - `.coinflip`, `.dice`: Arena Match Result Cards with Unicode dice and coin indicators.
   - `.top`, `.topglobal`: Hall of Fame Podium Cards with rank indicators (`🥇`, `🥈`, `🥉`).
   - `.vault`: House Vault Statement Card.
   - `.fevertime`: Broadcast Announcement Card with dynamic duration.
   - `.creategame`, `.joingame`, `.shoot`, `.use` (Buckshot Roulette): Tactical lobby waiting room HUD cards and live health gauges.

3. **Media Downloaders & System Diagnostics**:
   - `.tiktokdl`, `.pinterestdl`, `.ytdl`: Standardized metadata cards for title, author, and duration.
   - `.stats` / `.system_info`: Comprehensive Server Telemetry Dashboard featuring a live RAM usage progress bar gauge.

---

## 3. Verification & Compliance Checklist

- [x] **Strict PNPM Usage:** All builds and scripts executed exclusively via `pnpm`.
- [x] **Zero TypeScript Errors:** `pnpm typecheck` passed with 0 errors.
- [x] **Zero ESLint Errors:** `pnpm lint` passed with 0 errors and 0 warnings.
- [x] **i18n Parity (100%):** `pnpm run validate:i18n` verified complete key parity between `en` and `id`.
- [x] **Unit & Integration Test Suite:** All test suites passing (`tests/uiFormatter.test.ts`, `tests/bank.test.ts`, `tests/loan.test.ts`, `tests/job.test.ts`, `tests/idcard.test.ts`, `tests/i18n.test.ts`, `tests/cancel.test.ts`, `tests/menu.test.ts`).
- [x] **Rupiah Formatting Compliance:** All financial values strictly formatted via `formatRupiah` from `src/utils/currency.ts`.
- [x] **Version Bump:** `package.json` bumped to `RF-2609-06` adhering to `RF-YYMM-BUILD` versioning standards.
