# Changelog

All notable changes to the **Cosmos WhatsApp Bot Framework** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the `RF-YYMM-BUILD` version formatting.

---

## [Unreleased]

### Changed

- **Greedy Longest-Prefix Multi-Word Command Matching (`src/handlers/message.ts`, Rule AF):**
    - Upgraded multi-token command resolution from a fixed two-token lookup to greedy longest-prefix matching (evaluating 4 tokens down to 2 tokens), properly resolving 3-token and 4-token commands (e.g. `.set group lang`, `.toggle offline ai`) and isolating trailing arguments without rigid token slicing.
    - Routed canonical `.group add` and `.group del` commands through the message router alongside legacy `.addgroup` and `.delgroup` with identical ACL enforcement and QuotaService locks.

- **Tutorial Service & Commands Context Synchronization (`src/services/tutorialService.ts`, `docs/COMMANDS_CONTEXT.md`):**
    - Updated `relatedCommands` and `localizedRelatedCommands` across all tutorial suites to reference canonical multi-token commands while maintaining 100% tool coverage.
    - Synchronized command syntax headers and examples in `docs/COMMANDS_CONTEXT.md` to reflect canonical spaced commands for Sara AI knowledge grounding.

### Fixed

- **Canonical Spaced Command Synchronization in User Outputs & Locales (Issue #39, PR #40, Rule AF):**
    - Synchronized user-facing prompt strings, error hints, and interactive quick tips across `src/locales/en/` and `src/locales/id/` (`tools.json`, `games.json`, `media.json`, `utilities.json`, `core.json`) to use canonical space-separated commands (`.set lang`, `.set group lang`, `.daily claim`, `.shop buy`, `.property sell`, `.property catalog`, `.property inventory`, `.tg add`, `.tg del`, `.tg list`, `.auto dl`, `.tiktok dl`, `.yt dl`, `.pinterest dl`, `.telegram dl`, `.whitelist all`, `.group add`, `.group del`, `.start autocorrect`, `.stop autocorrect`, `.toggle autocorrect`, `.toggle offline ai`, `.create game`, `.join game`, `.start game`, `.register id`, `.check id`, `.my profile`, `.my quota`, `.system info`).
    - Added multi-token spaced aliases to tool definitions (`setlang`, `setgrouplang`, `tgadd`, `tgdel`, `tglist`, `autodl`, `tiktokdl`, `ytdl`, `pinterestdl`, `telegramdl`, `whitelist`).
    - Remediated hardcoded unspaced command strings in `src/tools/` (`profile.ts`, `balance.ts`, `tglist.ts`, `whitelist.ts`, `telegramdl.ts`, `autoarchive.ts`).
    - Expanded `LEGACY_COMMAND_MAP` in `src/utils/commandFormat.ts` to map transitioned legacy single-token triggers to canonical spaced commands with automatic deprecation guidance notices.

---

## [RF-2609-19] - 2026-09-25

### Changed

- **WhatsApp-Native Menu Redesign & Visual Clutter Removal (Issue #36):**
    - Redesigned all menu and help subsystem formatters (`src/utils/menuFormatter.ts`) to use 100% WhatsApp-native Markdown primitives: quotes (`> `), numbered lists (`1. `), bullet lists (`- `), bold (`*...*`), italics (`_..._`), and monospace (`` `...` ``).
    - Completely stripped brittle Unicode box-drawing characters (`╭━━━`, `┃`, `╰━━━`, `┌──`, `│`, `└──`) and extraneous symbols (`⭔`, decorative emoji barrages) across dashboard headers, category overview, command lists, full catalogs, command inspector guides, and tutorials.
    - Standardized bilingual localization under `menu` in `src/locales/en/tools.json` and `src/locales/id/tools.json`: clean category command headers without icons, em-dash category command count formatting (`— {{count}} commands` / `— {{count}} perintah`), and symmetric quote tip keys (`tip_detail`, `tip_category`).
    - Aligned integration test assertions in `tests/menu.test.ts` to enforce WhatsApp-native layout structures and absence of box borders and metadata emojis.

### Fixed

- **Standardized Multi-Word Command Syntax & Error Output Hints (Issue #35, Rule AF):**
    - Updated all command format examples and usage prompts in error outputs to use canonical space-separated commands (`.add balance`, `.top global`, `.my plan`, `.fever time`, `.auto archive`).
    - Standardized phone number examples in `src/tools/contact.ts` to valid international E.164 formats (`6281234567890`), preventing dummy placeholder input failures.
    - Corrected legacy `/sell` command prompts to the canonical `.sell` bot prefix (Rule M).

- **Standard Indonesian Rupiah Currency Terminology (Rule L):**
    - Replaced legacy casino "coin" / "koin" terminology across all tool definitions and locales with "balance", "saldo", or "Rupiah/balance" (`transfer.ts`, `balance.ts`, `daily.ts`, `slot.ts`).
    - Added formatted Rupiah examples (`50.000`, `Rp50.000`, `50k`) across bank, loan, dice, and slot validation error messages.

- **Bilingual Localization Parity (Rule O & T):**
    - Maintained 100% key, variable, and placeholder symmetry across `src/locales/en/` and `src/locales/id/` for `tools.json` and `games.json`.
    - Cleaned redundant alias duplicates in `src/services/tutorialService.ts`.

### Removed

- **Deprecated Media & Lyrics Features:**
    - Permanently purged obsolete and inactive commands: `stoptogglesticker`, `playlyrics`, `stoplyrics`, and `togglesticker`.
    - Removed unused `src/utils/lyricsPlayer.ts` and pruned references from policy matrices and documentation.

---

## [RF-2609-18] - 2026-09-25

### Added

- **Issue & Update Planning Governance (`AGENTS.md` Rule AD):**
    - Enforced mandatory pre-planning in `ISSUE.md` for all updates, bug fixes (major/medium), and new features or commands.
    - Established review gate: AI Agent must draft GitHub issues in `ISSUE.md` and obtain user review and explicit approval or instruction prior to publishing to GitHub.
    - Mandated strict adherence to official repository issue templates (`.github/ISSUE_TEMPLATE/bug_report.md` with `[BUG]` prefix and `.github/ISSUE_TEMPLATE/feature_request.md` with `[FEATURE]` prefix).

- **Issue & Pull Request Review Summaries Governance (`AGENTS.md` Rule AE):**
    - Mandated recording comprehensive summaries in `SUMMARY.md` following any issue or pull request review.
    - Standardized persistent structured summary schema (issue/PR ID, change scope, primary findings, risk assessment, review decision, and action items) for future AI and user context retention.

### Changed

- **Git Staging & Ignore Isolation (`.gitignore`, `AGENTS.md` Rule I & AE):**
    - Added explicit `.gitignore` rules for `ISSUE.md`, `ISSUE*.md`, `SUMMARY.md`, and `SUMMARY*.md` to guarantee they are never tracked or pushed to remote repositories, even during force pushes.
    - Updated Rule I and agent workflow in `AGENTS.md` to enforce local-only isolation for both `ISSUE.md` and `SUMMARY.md`.

### Removed

- **Tracked Junk & Test Artifacts:**
    - Removed obsolete subpath import testing artifacts from repository tracking (`index.js`, `package.json.test`, `utils.js`).

---

## [RF-2609-17] - 2026-09-24

### Added

- **Brat Text & Animated Sticker Generator (`src/tools/brat.ts`):**
    - Added `.brat` command supporting static image stickers (`https://api.siputzx.my.id/api/m/brat?text=...&delay=500`) and animated GIF stickers (`isAnimated=true`).
    - Multi-word and flag triggers: `.bratanimasi`, `.bratanimated`, `brat animasi`, `brat animated`, `.brat animated <text>`, `-a`, `--animated`, `--animasi`.
    - Dash parameter delay configuration: `-d <ms>`, `-d=<ms>`, `-<ms>ms`, `-<ms>`, and `--delay <ms>` (range: 50–5000 ms, default 500 ms).
    - Quoting/replied-message fallback: easily generate stickers from referenced text messages.
    - Comprehensive interactive tutorial card displayed when executing bare `.brat`.

- **Global WhatsApp Monospace & String Filtering Utility (`src/utils/monospace.ts`):**
    - Implemented centralized `extractLeadingMonospace`, `unwrapMonospace`, and `isMonospaceWrapped` utilities.
    - Standardized support for WhatsApp triple backtick (` ```...``` `), single inline backtick (`` `...` ``), double quotes (`"..."`), and single quotes (`'...'`).
    - Literal text disambiguation: allows users to generate literal text containing reserved keywords (e.g. `.brat "animasi keren"` or `.brat ```animasi keren``` `) without accidentally triggering animated mode.
    - Added repository-wide rule **Rule AC** in `AGENTS.md` and new specialized agent skill in `.agents/skills/whatsapp-monospace-filtering/SKILL.md`.

- **Full-Deep Commands Context & Knowledge Base for Sara AI (`docs/COMMANDS_CONTEXT.md`):**
    - Created exhaustive command documentation across all 69 tools, covering exact syntax, parameters, subcommands, flags, limits, and examples.
    - Injected into Sara Persona Execution prompt (`saraPersona.ts`) under `<cosmos_commands_knowledge>`.
    - Grounded Sara AI's responses with factual command syntax, eliminating hallucinations when users ask how to use bot features.

### Changed

- **Refactored Contact Book Tool (`src/tools/contact.ts`):**
    - Replaced fragmented ad-hoc regex with `extractLeadingMonospace` and `unwrapMonospace` for multi-word alias management with spaces (e.g. `.contact add `Ls Friends` 123456789`).

- **Menu and Help System Reflection (`src/services/menuService.ts`, `src/tools/brat.ts`):**
    - Updated brat tool definition and bilingual descriptions in `src/locales/{en,id}/tools.json` and `src/locales/{en,id}/media.json` to feature usage and example tutorials in `.menu` and `.help brat`.

---

## [RF-2609-16] - 2026-09-24

### Fixed

- **Owner Contact Resolution & Token Hallucination Defense (`CosmosAgentEngine`):**
    - Pre-minted zero-knowledge contact tokens for the bot owner (`Razael`, `Owner`, `subBotOwnerName`) in `SaraPromptContextResolver`, enabling any user to send messages to the owner via `.sara message Razael ...`.
    - Added owner and system alias resolution (`razael`, `owner`, `pemilik`, `creator`, `developer`) in `AgentEntityResolver.resolveRecipientToken`.
    - Implemented token validity verification (`EphemeralTokenStore.isValidToken`) and hallucination defense in `AgentGuidancePlanner.plan` to intercept and discard hallucinated `contact_ref_...` tokens from Tier 1.
    - Added dynamic fallback in Guidance Planner to resolve missing or invalid tokens from `rawAlias` via `AgentEntityResolver`.
    - Guarded against invoking `send_message` or `send_location` with invalid tokens, preventing technical leaks (_"token penerima tidak valid atau sudah kedaluwarsa"_).
    - Added sender attribution caption (`— Sent by ${cleanSenderName} via Sara AI`) to `sendMessageTool` when dispatching messages to third parties.

### Changed

- **Natural, Non-Stiff Sara Persona Architecture:**
    - Redesigned `buildSaraPersonaPrompt` and `offlineAi.ts` system prompts with emotional intelligence (EQ), natural WhatsApp texting cadence, and conversational acknowledgment.
    - Banished robotic bot clichés (_"Certainly!", "As an AI...", "Tentu saja!"_) in favor of natural conversational phrasing in Indonesian and English.

---

## [RF-2609-15] - 2026-09-24

### Added

- **CosmosAgentEngine: Safe and Deterministic AI Tool Execution Runtime for Groq Provider (#28):**
    - **Two-Tier Guidance + Execution Dual-LLM Pipeline:**
        - **Tier 1 (Analytical Guidance Planner — `llama-3.1-8b-instant` / `openai/gpt-oss-20b`):** Fast (<300ms) intent parser that extracts structured user goals, resolves human relations/nicknames into synthetic tokens, and generates a typed `GuidanceBrief` via Groq JSON mode.
        - **Tier 2 (Persona Executor — `llama-3.3-70b-versatile` / `openai/gpt-oss-120b`):** High-parameter reasoning core with Sara's conversational persona, executing native tool calls against strictly scoped tool definitions (1 candidate tool max, preventing token flooding and TPM quota exhaustion).
        - **Dynamic Model Fallback Chain & Active Caching:** Automatic fallback across Tier 1 and Tier 2 if a model is decommissioned or returns 404, with in-memory caching of the working model for sub-second execution.
    - **Zero-Knowledge Personal Contact Security (Ephemeral Nonces in RAM):**
        - Raw phone numbers are strictly scrubbed and never exposed to any LLM prompt context.
        - Contacts are abstracted into cryptographically random 128-bit nonces (`contact_ref_...`) in server RAM, strictly bound to `callerJid` with a 3-minute ephemeral TTL, capability scoping (`allowedTools`), and LRU eviction (max 10,000 global, max 10 per user).
        - Stored at rest in `UserContactBook` SQLite table using AES-256-GCM encryption (`encryptString`/`decryptString`).
    - **Interactive Confirmation Manager & TOCTOU Protection (`AgentConfirmationManager`):**
        - High-risk financial and inventory operations (`bank_action`, `transfer`, `loan`) are staged in memory and integrated with `cancellationManager` (`.confirm` / `.cancel`).
        - Verifies sender JID and LID identity to prevent group chat confirmation hijacking.
        - Re-evaluates balances and state atomically inside `prisma.$transaction` upon confirmation.
    - **Remote Location Forwarding & Delegation via Sub-Bot ("shareloc"):**
        - Supported via both single-pass quoted location messages and interactive 2-step flows (`.sara please send this location to Mom` followed by location pin / `shareloc`).
        - Dispatches native WhatsApp `locationMessage` to the target contact with attribution caption: `"${senderName} sent this from a different number — Sara AI"`.
    - **Advanced International Phone Number Sanitization (`src/utils/phone.ts`):**
        - Multi-token spaced input parsing (`.contact add Friend +94 77 837 0112`).
        - International country code preservation (+ strip), Indonesian local `08` -> `628` conversion, accidental `6208` correction, and international `00` exit code removal.
    - **Groq Self-Healing Interceptor (`tool_use_failed` Recovery):**
        - Intercepts Groq HTTP 400 errors where tool invocations leak into `error.failed_generation`, extracting function arguments and re-validating recovered tools through the TypeScript Policy Gate before execution.
    - **Front-End Integration:**
        - User-facing `.sara` / `.ai` command (`src/tools/sara.ts`).
        - Refactored `src/utils/offlineAi.ts` to delegate text-based turns to `CosmosAgentEngine.processMessage`.

---

## [RF-2609-14] - 2026-09-23

### Fixed

- **LID/JID Identity Unification — Balance Loss After `.claim` (`src/utils/casino.ts`, multiple tools & services):**
    - Fixed a critical bug where `.slot` (and other gambling tools) incorrectly reported "Insufficient balance" immediately after a successful `.claim` for users identified via WhatsApp LID.
    - **Root cause:** `getSenderJid` applied a `length > 14` heuristic to detect LID identifiers, but 14-digit LIDs (e.g. `14392720638086`) failed the check and were incorrectly treated as phone numbers, producing a phantom JID (`14392720638086@s.whatsapp.net`). `.claim` wrote the rewarded balance to the phantom record while subsequent gambling commands resolved the canonical phone-number JID (starterpack 10,000) — triggering a false insufficient-balance error.
    - Corrected LID detection heuristic from `length > 14` to `length >= 13` in `getSenderJid`, `buildUserOrConditions`, and `getUser`.
    - Added `pnToLidMap` alongside the existing `lidToPnMap` for bidirectional LID ↔ phone-number resolution; both maps are populated on every message that carries `participantAlt`.
    - `buildUserOrConditions` now emits all identifier variants (canonical JID, bare digits, full LID, `@lid`-suffixed LID, and mapped phone number from both directions) so any incoming format unambiguously hits the single canonical database record.
    - `getSenderJid` returns the cached canonical JID even on subsequent messages where `participantAlt` is absent (cache-fallback path).
    - `getUser` resolves `targetId`/`targetLid` from in-memory maps before falling back to raw input, preventing phantom user creation.
    - `getChatLanguage` (`src/utils/i18n.ts`) updated to use `buildUserOrConditions` for LID-safe language preference lookup.
    - All user `findFirst` calls in `src/services/jobs.ts` migrated to `buildUserOrConditions`; type-safe `getUser` fallback on join-job path.
    - `src/services/shopService.ts` migrated from raw `findFirst` to `getUser`.
    - `src/tools/balance.ts` and `src/tools/transfer.ts` use `cleanId()` comparison to prevent false self-check/self-transfer denials when sender and target share digits but differ in domain suffix.
    - `src/tools/property_buy.ts`, `property_inventory.ts`, `property_sell.ts`, `roulette_bet.ts`, `roulette_joingame.ts` all migrated to `buildUserOrConditions`.
    - Added end-to-end regression test `tests/claim_and_gamble_lifecycle.test.ts` covering the full `.claim` → `.slot 20k` lifecycle across LID, canonical JID, and bare-digit identifier variants with phantom-user and balance-preservation assertions.

---

## [RF-2609-13] - 2026-09-23

### Added

- **Comprehensive Internationalization Remediation Across Tools & Services (#27):**
    - **100% Fully-Keyed Output:** Remediated all remaining unlocalized and partially localized tools (`system_info.ts`, `myplan.ts`, `slot.ts`, `dice.ts`, `coinflip.ts`, `vault.ts`, `top.ts`, `topglobal.ts`, `shop.ts`, `property_catalog.ts`, `property_inventory.ts`, `loan.ts`, `idcard.ts`, `config.ts`, `subbot.ts`, `setlang.ts`, `subscription.ts`, `roulette_creategame.ts`, `roulette_joingame.ts`, `roulette_startgame.ts`, `roulette_shoot.ts`, `roulette_use.ts`, `pinterestdl.ts`, `tglist.ts`, `autodl.ts`, `daily.ts`, `fevertime.ts`, `stickerly.ts`, `telegramdl.ts`, `readviewonce.ts`), achieving 0 unlocalized tools repository-wide.
    - **Shared Renderers Localization Layer (`src/utils/uiFormatter.ts`, `src/utils/menuFormatter.ts`):** Made `t?: TranslatorFn` an optional non-breaking parameter in `CardOptions`, `AlertOptions`, `renderCatalogCard`, and `renderHealthGauge` with Formal English fallbacks; localized alert titles (`SUCCESS`, `WARNING`, `ERROR`, `INFORMATION`, `NOTICE`), tip prefixes, and health gauges.
    - **Menu Category Slug vs. Display Label Separation (`src/services/menuService.ts`):** Established immutable category IDs/slugs (`cat.id`) for category routing (`.menu <category>`) while rendering localized titles via `tools.menu.categories.<slug>`, supporting both English and Indonesian category names and aliases.
    - **Push & Background Notification Localization:** Localized web login security alerts (`securityAlertService.ts`), web registration OTP and verification notices (`ipcServer.ts`), subscription expiry notifications (`subscriptionChecker.ts`), sub-bot pairing push receipts (`subBotService.ts`), and background loan overdue/seizure warnings (`loanService.ts`).
    - **Dynamic Per-Group Broadcast Language Resolution:** Refactored duplicate forex broadcast templates across `broadcast.ts` and `subBotService.ts` into a unified `renderForexBroadcast(...)` helper resolving per-group language settings (`group.language || 'id'`).
    - **Database Catalog Translations (`src/utils/i18n.ts`):** Added `getPropertyWithTranslation(...)` and backfilled all 12 initial shop items and 6 property catalog entries across `src/locales/id/tools.json` and `src/locales/en/tools.json`.
    - **Global Cancellation Manager Key Support (`src/utils/cancellationManager.ts`):** Added `descriptionKey` and `descriptionVars` to `CancellableSession` to dynamically resolve translated cancellation messages.
    - **Hardened i18n Guardrails & Host Testing:**
        - Decoupled direct database imports in `i18n.ts` and `broadcast.ts` with deferred dynamic imports, preventing `SQLITE_CANTOPEN` errors during host test execution.
        - Hardened `scripts/validate-i18n.ts` with strict bidirectional key symmetry, empty/whitespace value detection, and interpolation variable set parity validation (`{{var}}`).
        - Added static AST/regex key usage scanner (`scripts/check-i18n-usage.ts`) wired into `pnpm run validate:i18n`.
        - Created isolated card unit tests (`tests/i18n_cards.test.ts`) covering all formatters and localized cards.

### Changed

- **Eliminated Fragile Logic Couplings on English Prose:**
    - Refactored `shopService.ts` to return typed `PurchaseResult.code` values (`INSUFFICIENT_BALANCE`, `NOT_FOUND`, `UNAVAILABLE`, `INVALID_QUANTITY`, `DATABASE_ERROR`), decoupling `property_buy.ts` from English substring matching.
    - Decoupled `message.ts` pagination and auto-sticker handling from language-dependent error prefix checks.
    - Corrected mixed-language AI prompts in `loanService.ts` and `offlineAi.ts` to Formal English directives enforcing Native Function Calling without raw XML tags.

## [RF-2609-12] - 2026-09-23

### Added

- **Canonical Space-Separated Multi-Word Commands & Localized Parent Titles (#26):**
    - Supported space-separated multi-word command syntax (`.register id`, `.check id`, `.apply license`, `.apply job`) with two-token longest-match parser resolution.
    - Localized Indonesian parent command titles in `.menu`, `.menu all`, `.menu <category>`, and `.help <command>`: renders `.buat ktp`, `.cek ktp`, `.pasang sim`, and `.lamar kerja` in Indonesian chats (`id`) and canonical space forms in English chats (`en`).
    - Added full suite of Indonesian aliases (`.daftar id`, `.daftar ktp`, `.buat ktp`, `.cek id`, `.cek ktp`, `.lihat ktp`, `.pasang sim`, `.buat sim`, `.ajukan sim`, `.daftar sim`, `.lamar kerja`, `.lamar pekerjaan`, `.daftar kerja`).
    - Integrated interactive job selection flow for bare `.lamar kerja` without target, prompting users to choose a position with `.cancel` support via `cancellationManager`.
    - Added language-resolved deprecation notices for legacy hyphenated and concatenated triggers (`.register-id`, `.registerid`, `.check-id`, `.apply-license`, `.applylicense`, `.apply-job`, `.applyjob`).

---

## [RF-2609-11] - 2026-09-20

### Added

- **Unified Single-Container Production Architecture (`cosmos-origin`):**
    - Multi-stage Docker container (`docker/Dockerfile`) bundling WhatsApp Bot Engine, Fastify API Gateway, Next.js Web Portal, unprivileged Nginx reverse proxy, and Cloudflare Tunnel runner under non-root user `cosmos` (UID 1001).
    - PM2 supervision (`docker/ecosystem.config.cjs`) with per-process resource limits, failover backoff, and runtime unpackaged-service filtering.
    - Automated lifecycle and deployment toolchain (`scripts/docker-build.sh`, `scripts/docker-deploy.sh`, `scripts/docker-dev.sh`).
    - Doppler Secret Manager integration (`scripts/sync-doppler.sh`) for automated secret synchronization across `dev` and `prd`.
    - Automated Cloudflare Tunnel configuration (`scripts/setup-cloudflare-tunnel.sh`) and Turnstile widget provisioning (`scripts/create-turnstile-widget.sh`).

- **Sticker.ly Pack Search & Tray Export (`src/tools/stickerly.ts`, `src/services/stickerlyService.ts`, `src/utils/stickerPackBuilder.ts`):**
    - Sticker.ly pack search and export command (`.stickerly`, `.spack`, `.stickerpack`) integrated via Dongtube API with Doppler secret management.
    - Sequential 5-pack preview cards using native WhatsApp attachments with zero-clutter lifecycle (immediate delete-for-everyone upon selection, timeout, or cancellation).
    - Automated 512x512 WebP normalization, 252x252 tray icon generation, companion `.wastickers` zip packaging, and WhatsApp MMS encrypted `stickerPackMessage` tray distribution.

- **Centralized Quota, Inverted OTP Verification & Subscription Engine (`src/services/quotaService.ts`, `src/services/otpService.ts`, `src/services/subscriptionService.ts`, `src/tools/verify.ts`, `src/tools/subscription.ts`):**
    - Inverted Click-to-Chat WhatsApp verification flow (`.verify <TOKEN>`) with sender-number verification binding and attempt throttling.
    - Tier-based quota enforcement (Free, Subsidized, Partner) governing group whitelisting and sub-bot instance pairing limits.
    - Subscription lifecycle engine with automated expiry reconciliation and `.sub add` administrative provisioning.
    - Authenticated Unix domain socket IPC bridge (`/app/storage/ipc.sock`) with HMAC shared secrets for real-time OTP, presence, and session state coordination.

### Changed

- **Interactive Startup Pairing & Credential Separation (`src/utils/startupPrompt.ts`, `src/utils/owner.ts`):**
    - Decoupled owner phone number from bot instance identity, featuring interactive terminal pairing prompts upon clean initialization.

### Fixed

- **Backup Deduplication & Presence Tracking (`src/utils/backup.ts`, `src/services/presenceService.ts`):**
    - Prevented duplicate Telegram database backup archives using content-hash gated uploads.
    - Established bidirectional JID/LID presence linking and automated contact display name synchronization.

---

## [RF-2609-10] - 2026-09-15

### Added

- **Google Pixel 9a Asset (`src/seed_item.ts`, `src/seed_property.ts`):**
    - Added `Google Pixel 9a` (`pixel9a`) equipment item to the shop catalog at Rp7.999.000, positioned as the affordable Android alternative to `iPhone`.
    - Added `Google Pixel 9a` to the property catalog (`Electronics`, 3% depreciation) at Rp7.999.000, consistent with the $499 US MSRP.

### Changed

- **Economy Price Refresh to 2025–2026 Market Rates (`src/seed_item.ts`, `src/seed_property.ts`, `src/services/jobs.ts`):**
    - Shop catalog: Gorengan Rp2.000 → Rp2.500, Yakult Rp2.500 → Rp3.000, Tolak Angin Rp3.500 → Rp5.000, Indomie Goreng Rp3.500 → Rp4.000, Bambu Runcing Rp15.000 → Rp25.000, Sandal Swallow Rp12.000 → Rp18.000, Sarung BHS Rp500.000 → Rp650.000, Pickaxe Rp50.000 → Rp85.000, MacBook Rp15.000.000 → Rp17.999.000, iPhone Rp12.000.000 → Rp12.499.000, Driver's License Rp100.000 → Rp120.000.
    - Property catalog: Honda Scoopy Motorcycle Rp23.100.000 → Rp23.681.000, Rolex Submariner Watch Rp150.000.000 → Rp185.000.000, iPhone 15 Pro Max Rp25.000.000 → Rp19.999.000, MacBook Pro M3 Max Rp65.000.000 → Rp59.999.000, Bali Beach Villa Rp2.500.000.000 → Rp4.250.000.000.
    - Synced the duplicated `seedDefaultJobs` item prices in `src/services/jobs.ts` so job seeding no longer overwrites the refreshed shop prices.

---

## [RF-2609-09] - 2026-09-15

### Fixed

- **Sub-Bot Pairing Handshake & Boot Guard (`src/services/subBotService.ts`, `src/utils/connectionManager.ts`):**
    - Fixed pairing code request loop triggering repeated handshake reconnects during sub-bot pairing.
    - Fixed startup routine booting unregistered sub-bot instances without valid database files.

- **Job & Career System Localization (`src/services/jobs.ts`, `src/tools/job.ts`, `src/tools/work.ts`):**
    - Eliminated hardcoded English strings across the job application, employment status, and work shift flows.
    - Added symmetrical `en`/`id` translation keys for apply/resign failures, career status titles, shift labels, catalog headers, job names/descriptions, ore names, and mining/entrepreneur shift variance narratives.

- **Global i18n Hardcoded-Strings Sweep (`src/tools/`, `src/utils/`, `src/services/`, `src/handlers/`):**
    - Fixed invalid bare `ui.*` translation keys (no such namespace exists) in `balance.ts`, `daily.ts`, and `uiFormatter.ts` by routing to `tools.ui.*`; added missing `tools.ui` account, wealth-tier, and membership-tier labels in both languages.
    - Replaced hardcoded user-facing literals with `ctx.t` keys in `config.ts` (API/mode/prefix/name/language validation), `loan.ts` (disbursement/repayment/assessment fallbacks), `subbot.ts` (stop/start/empty-list states), and `transfer.ts` (in-transaction insufficient-balance error).
    - Localized TikTok (`card_title`, label/value tokens, API error) and YouTube (`card_title`, type labels) downloader caption cards in `tiktokdl.ts` and `ytdl.ts`.
    - Routed sticker pipeline errors (`invalid_format`, `ffmpeg_missing`, `process_failed`, WebP validation, queue-full) through `media.sticker` keys in `sticker_maker.ts` and `stickerQueue.ts`.
    - Localized cancellation fallback messages with language-aware `t` passthrough from `cancel.ts` and `handlers/message.ts` into `cancellationManager.ts`.
    - Sourced Telegram client, API key, and casino `User not found` errors from `utilities.telegram`, `utilities.apikey`, and `utilities.casino` keys.
    - Rewrote the `services/ai.ts` economic-analysis system prompt in Formal English (removed mixed Indonesian instruction) per output-string standards.
    - Verified zero unresolved `t()` keys codebase-wide; `validate:i18n` reports full `id`/`en` symmetry.

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

[Unreleased]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-19...HEAD
[RF-2609-19]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-18...RF-2609-19
[RF-2609-18]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-17...RF-2609-18
[RF-2609-17]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-16...RF-2609-17
[RF-2609-16]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-15...RF-2609-16
[RF-2609-15]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-14...RF-2609-15
[RF-2609-14]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-13...RF-2609-14
[RF-2609-13]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-12...RF-2609-13
[RF-2609-12]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-11...RF-2609-12
[RF-2609-11]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-10...RF-2609-11
[RF-2609-10]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-09...RF-2609-10
[RF-2609-09]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-08...RF-2609-09
[RF-2609-08]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-07...RF-2609-08
[RF-2609-07]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-06...RF-2609-07
[RF-2609-06]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-05...RF-2609-06
[RF-2609-05]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-04...RF-2609-05
[RF-2609-04]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-03...RF-2609-04
[RF-2609-03]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-02...RF-2609-03
[RF-2609-02]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-01...RF-2609-02
[RF-2609-01]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2608-01...RF-2609-01
[RF-2608-01]: https://github.com/razaelmahasaputra/cosmos/releases/tag/RF-2608-01
