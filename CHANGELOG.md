# Changelog

All notable changes to the **Cosmos WhatsApp Bot Framework** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases use the Cosmos dated version format `G<generation>-F<featureMilestone>-P<patch>` (for example `G2-F24-P7`).
Machine-readable version metadata lives in [`version.json`](version.json); see [`docs/VERSIONING.md`](docs/VERSIONING.md).
Releases published before the 2026-09-30 migration use the legacy `RF-YYMM-BUILD` format and are retained below as historical records.

---

## [G2-F32-P1] - 2026-10-05

### Changed — Release Chain Completes via Actions API

- Git pushes (including with the configured `RELEASE_TOKEN` PAT) were observed
  not to start downstream workflows, so `version-automation.yml` now completes
  the chain itself with the default `GITHUB_TOKEN`: `gh release create` with the
  CHANGELOG-extracted notes (idempotent — skips if the release already exists)
  and `gh workflow run 'Publish Docker Image to GHCR'`.
- `docker-publish.yml` gained a `workflow_dispatch` trigger (`tag` input) and a
  per-tag concurrency group so a PAT-triggered tag push and the API dispatch
  cannot build the same tag twice. `RELEASE_TOKEN` is now optional.

---

## [G2-F31-P15] - 2026-10-05

### Added — Version & Release CI Automation

- `release.yml`: pushing a version tag (`G*-F*-P*`) validates the tag against `version.json`
  (fail-closed), slices the matching `## [<version>]` section out of `CHANGELOG.md` as the
  GitHub Release body, and falls back to `--generate-notes` when the section is absent.
- `version-automation.yml`: on push to `main`, tags the new version when the push carried a
  `version.json` bump; otherwise auto-bumps using a Conventional Commits classifier
  (`BREAKING CHANGE` / `type!:` → `generation`, `feat:` → `feature`, else `patch`), seeds a
  CHANGELOG stub from commit subjects, registers feature milestones in `docs/VERSIONING.md`,
  and pushes the tag — chaining into the release and Docker workflows. Manual override via
  `workflow_dispatch`. Tag pushes use the `RELEASE_TOKEN` PAT secret (GitHub's recursion guard
  blocks `GITHUB_TOKEN`-pushed tags from triggering downstream workflows); tags are shape-
  validated in `release.yml`.
- `format.yml`: Prettier over the whole codebase on every push to `main`, committed as
  `github-actions[bot]` with `[skip ci]`; serialized with version automation via the
  `main-automation` concurrency group.
- Docs: `AGENTS.md` Rule AI, `.agents/skills/version-release-automation/SKILL.md`, `HOW.md`.

---

## [G2-F32-P0] - 2026-10-05

### Added — Progressive Disclosure UX (Issue #71) — Feature Milestone F32

- **Step 1 — Tiered `.menu`:** the no-arg `.menu` now renders the Layer 1 Core Surface
  (`CORE_COMMANDS`, 6 pinned commands) via `formatCoreCommands`, sized to fit the 1024-char
  image caption. `.menu all` keeps the full catalog; the previous category overview moved to
  `.menu categories`.
- **Step 2 — First-contact onboarding:** a one-time greeting (`tools.onboarding.welcome`) is
  sent when the sender's `User` row does not exist at handler entry, then the handler falls
  through so the first real command still executes. Skipped for owners/`fromMe` and
  non-whitelisted groups.
- **Step 3 — Confidence gate:** the parser gained rung 2 (category alias shortcut via
  `menuService.getCategoryAliasSet()`, rendering `.downloader` / `.economy` / `.game` as
  `.menu <category>`) and rungs 3–4 (unmatched prefix-led messages drop silently instead of
  leaking to offline-AI/autodl). `.ai is useless`-style fragments (≤ 3 tokens, no question
  mark, no request verb) now get a clarification prompt via `isCasualFragment` in `sara.ts`.
- **Step 4 — Contextual inline hints:** after a successful core command, one unused adjacent
  command is suggested (`src/utils/commandHints.ts`, in-RAM per-user usage memory; resets on
  restart by design).

---

## [G2-F31-P10] - 2026-10-05

### Added — Per-Feature Usage Limits (Issue #72)

One shared sliding-window limiter now guards the expensive command classes, replacing the
hand-rolled per-tool cooldowns that previously had no common abstraction.

- `limitKey` / `limit` on `ToolDefinition`, enforced at the single funnel `ToolsHandler.execute()`
  — the auto-sticker trigger in `message.ts` is covered without its own call site.
- `src/utils/featureLimiter.ts`: sliding-window counter plus a 60-second tier cache (one
  `findUnique` instead of `getUserQuota()`'s three queries), invalidated eagerly by the IPC
  `/internal/subscriptions/activated` hook so upgrades apply immediately.
- `TIER_LIMITS` gained `featureLimits` for `sticker`, `download`, and `stt` across all three
  tiers. `ai` and `webSearch` are deliberately absent: agent tools never reach the funnel and
  stay bounded by `AgentRateLimiter`.
- `.my quota` renders one usage bar per limited feature; `.my plan` lists the tier ceilings.
- The owner JID bypasses every limit; exceeding one returns a localized wait-time reply
  (`core.limits.cooldown`, with `core.limits.cooldown_free` for Pulse users).

---

## [G2-F31-P9] - 2026-10-05

### Fixed — `pnpm validate:i18n` no longer reports a bogus missing key

`pnpm run validate:i18n` (Rule O) exited non-zero on two phantom findings:

```
- src/mcp/schema/i18nAudit.ts:95 -> "..."
```

`scripts/check-i18n-usage.ts` locates translation keys with a regex applied to raw file text.
A doc comment on line 95 that documents the very syntax being matched — `any t('...') /
ctx.t('...') / 'namespace.key'` form`— was read as two real call sites, so the literal`"..."` was treated as a key and reported missing from the catalog. The catalog was fine; the
scanner was matching comments.

- `maskComments()` blanks line and block comments while preserving every byte offset, so match
  offsets stay aligned with the original source and reported line numbers remain correct.
  String and template literals are deliberately preserved, since a legitimate key lives
  inside one.
- Line numbers are now computed from the unmasked source, so diagnostics point at the real
  line even though matching runs against the masked copy.

Verified that this tightens nothing it should not:

- A deliberately broken `descriptionKey` and a `t()` call with a bogus key, both inserted as
  real code in `src/tools/brat.ts`, were still reported with correct line numbers, while a
  `t('...')` reference planted in a comment on the adjacent line was ignored.
- A URL literal (`http://x.com/t('...')`) is not mistaken for a comment, and escaped quotes
  inside a string do not desynchronise the scanner.

The audit is not wired into `.github/workflows/`, so this did not block CI, but it is the
documented Rule O command and a permanently red exit makes it impossible to trust.

Version: `G2-F31-P8` → `G2-F31-P9` (patch)

---

## [G2-F31-P8] - 2026-10-05

### Fixed — two red test suites on `main`, plus 17 commands with no tutorial

`tests/tutorials.test.ts` and `tests/brat.test.ts` were both failing on `main`. Neither was
caused by the recent work; both were latent breakage that predates it.

#### Removed — orphaned `roulette` tutorial suite

The Buckshot Roulette feature was decommissioned in #44, and its locale keys were deleted at
the same time, but the suite definition itself stayed behind in `tutorialService.ts`. The
`.menu tutorial` hub renders every suite unconditionally, so users were shown a numbered entry
for a feature that no longer exists, and selecting it produced untranslated fallback text
because its `tools.tutorials.roulette.*` keys resolve to nothing. All roulette tool modules
are already gone from `src/tools/`. The suite is removed.

#### Fixed — 17 registered commands had no tutorial mapping

`tests/tutorials.test.ts` asserts 100% tutorial coverage over the tool registry, and the
assertion had been unreachable behind the earlier suite-count failure. With the count fixed it
surfaced: 77 tools, 17 unmapped.

- The 14 `.group *` moderation commands (`approve`, `blacklist add`, `blacklist list`,
  `blacklist remove`, `close`, `demote`, `description`, `invite`, `kick`, `link`, `open`,
  `promote`, `reject`, `rename`) are now aliases of the `moderation` suite, added to its
  `relatedCommands` and to both the `en` and `id` localized lists so parity holds.
- `.remove background` and its aliases are mapped to the `sticker` suite alongside `brat` and
  `stickerly`, which is where the other Media & Stickers media tools already live.
- `.status notify` and `.status report` are mapped to the `system` suite.

Coverage is now 77/77.

#### Fixed — `brat` test asserted against a field that changed meaning

`tests/brat.test.ts` looked up its normalized tool with `normalizedTools.find((n) =>
n.name === 'brat')`, but `processTools()` returns the localized display name, which became
`brat sticker` when PR #50 added `displayNames` per Rule AF. The find returned `undefined` and
the suite reported `menuService must normalize brat tool`, pointing at the menu service rather
than at the stale expectation. The lookup now compares against
`toolBrat.definition.displayNames?.en`, so it survives future display-name changes instead of
silently matching nothing. The usage assertion now reports the offending value on failure.

All 12 command/tutorial suites pass, including the 6,984-invocation vocabulary sweep.

Version: `G2-F31-P7` → `G2-F31-P8` (patch)

---

## [G2-F31-P7] - 2026-10-05

### Fixed — a broken environment no longer masquerades as a broken command parser

`tests/spaced_command_prefix.test.ts` failed with
`AssertionError: expected 'menu', got undefined`, which reads as _". menu is broken"_ and
points at `commandNormalize.ts`. The command parser was fine. `ToolsHandler.loadTools()`
imports every module under `src/tools/`, and most of them transitively open the SQLite
database. With an unwritable database path, 68 of 77 modules threw `EACCES` on import, each
error was swallowed by a bare `catch` that only wrote to the console, and the registry was
left quietly half-empty. Every `getTool()` lookup then returned `undefined`, so the test
asserted against an environment failure while blaming the parser.

Three changes, all at the source rather than at each call site:

- `loadTools()` records each import failure instead of discarding it, and reports the count,
  the first ten affected files, and the first root cause as a single console line (Rule C
  visibility, without the 68-line flood the per-file logging produced).
- `loadTools()` now throws when the registry comes back completely empty. Zero registered
  tools is never a legitimate state, so it is a real fault rather than something to absorb.
- `getToolCount()` and `getLoadFailures()` expose the outcome, so a test can distinguish
  _this command does not exist_ from _the environment is broken_.

`tests/spaced_command_prefix.test.ts` asserts zero load failures before its first registry
lookup, so a bad `DATABASE_URL` now fails with the actual cause and a suggested fix:

```
68 tool module(s) failed to import, so registry lookups are unreliable.
First cause: addbalance.ts — EACCES: permission denied, mkdir '/nonexistent-dir-xyz/storage'.
Set a writable DATABASE_URL, e.g. DATABASE_URL="file:/tmp/cosmos/storage/database.sqlite".
```

Verified in both directions: the broken path reports the environment fault, and the healthy
path still passes all 16 tests including the 6,984-invocation vocabulary sweep.

Version: `G2-F31-P6` → `G2-F31-P7` (patch)

---

## [G2-F31-P6] - 2026-10-05

### Fixed — Tier 1 guidance prompt now asks for `docQuestion`, reviving the docs route

The OpenRouter documentation route shipped in #68 was inert on `main`. The whole pipeline was
present — `OpenRouterDocsClient`, the `docQuestion` field on `GuidanceBrief`, the planner
assignment in `guidancePlanner.ts`, and the fast-path branch in `index.ts` — but the Tier 1
guidance prompt never instructed the planner to emit `docQuestion`, and never declared it in the
expected JSON schema.

`parsed.docQuestion === true` could therefore never be true, so `brief.docQuestion === true`
never held and the branch was unreachable. Every documentation question fell through to the
Groq Tier 2 path regardless.

- `saraGuidance.ts` gains directive 7 explaining when to set `docQuestion` (`true` only for
  "how do I use X" / "what does X do" style questions, `false` for search lookups and chat).
- `"docQuestion": boolean` is declared in the expected JSON schema so the model has a slot
  to fill; the schema is the contract the parser reads.
- The old directive 7 is renumbered to 8 so the prompt's numbering stays sequential.
- `tests/agentEngine.test.ts` asserts the schema field and the directive are both present, and
  that the numbering is unbroken.

The Laya fast-path guard in `guidancePlanner.ts` (`looksLikeDocQuestion`) was already present
and already exempted doc questions, so it now has something to route.

Version: `G2-F31-P5` → `G2-F31-P6` (patch)

---

## [G2-F31-P5] - 2026-10-05

### Fixed — Tier 2 prompt no longer exceeds the provider token ceiling

Sara replied _"an error occurred while processing your request"_ to every question once
web search went live. Tier 1 correctly selected `web_search`, but Tier 2 was rejected with
HTTP 413: the request needed ~8,600 tokens against an 8,000 per-minute limit. The model
fallback chain could not recover, because every candidate model shares that ceiling.

`src/services/agentEngine/prompts/saraPersona.ts` already exported
`shouldIncludeCommandsKnowledge()` and `buildSaraPersonaPrompt()` already accepted the flag,
but `AgentExecutor.executeTurn()` never passed it — so the ~6,100-token
`docs/COMMANDS_CONTEXT.md` reference stayed attached to every request.

- `executor.ts` now derives the flag from the caller text and the planned tool, and the
  knowledge base is attached only when the caller is actually asking about Cosmos itself.
- Search results, general knowledge, and small talk no longer pay for it.
- `tests/commandsKnowledge.test.ts` covers the gate: a Cosmos command question includes the
  reference, an unrelated question omits it, and a dispatched tool short-circuits to omitted.

Measured prompt sizes, against the 8,000-token ceiling:

| Request                   | Before            | After  |
| ------------------------- | ----------------- | ------ |
| Search / general question | ~8,600 (rejected) | ~2,100 |
| Cosmos command question   | ~8,600 (rejected) | ~3,500 |

Version: `G2-F31-P4` → `G2-F31-P5` (patch)

---

## [G2-F31-P4] - 2026-10-04

### Added — sample database schema appendix for the feature-limit specification

#### Added

- `docs/FEATURE_LIMITS.md` §10 now gives implementers concrete DDL: the existing
  `Subscription` table the limiter reads (no migration required), plus optional Phase 2
  `FeatureLimit` (admin-editable per-tier ceilings, seeded from the §5.4 matrix) and Phase 3
  `FeatureUsage` (restart-safe fixed-window counters with pruning rules), each as a Prisma model
  and the matching `ensureDatabaseSchema()` SQLite block, with a Rule W maintenance checklist.

## [G2-F31-P3] - 2026-10-04

### Changed — feature-limit specification is now plan-aware

#### Changed

- `docs/FEATURE_LIMITS.md` now scales per-feature usage limits with the subscriber's plan
  (`Pulse`/`FREE`, `Nova`/`SUBSIDIZED`, `Zenith`/`PARTNER`): resolution order with owner bypass
  and automatic expiry fallback, a 60-second cached tier lookup invalidated on plan activation,
  the proposed limit matrix per tier, and the surfaces where the numbers must appear (`.my quota`,
  `.my plan`, `/pricing`). Design only — no behaviour change.

## [G2-F31-P2] - 2026-10-04

### Added — Tavily web search for Sara AI, and the feature-limit design specification

#### Added

- The Sara AI agent engine can now answer time-sensitive questions with the `web_search` tool
  backed by Tavily (`src/services/agentEngine/tools/webSearch.ts`). Configure `TAVILY_API_KEY`
  in `.env`; when it is absent the tool disables itself gracefully and Sara replies with a
  localized notice instead of failing.
- `docs/FEATURE_LIMITS.md`: design specification for the per-feature usage limit system
  (sliding-window counters declared on `ToolDefinition`, enforced once in `ToolsHandler.execute()`).
  Design only — no behaviour change in this release.

## [G2-F31-P1] - 2026-10-04

### Fixed — background remover handles ephemeral messages and stalled downloads

#### Fixed

- `.remove background` now unwraps `ephemeralMessage` containers when locating the
  attached or quoted image, and bounds the media download with the 20 s deadline
  (stalls return the localized timeout message instead of hanging).

---

## [G2-F31-P0] - 2026-10-04

### Added — command background remover (Issue #69)

#### Added

- New `.remove background` command (`src/tools/remove_background.ts`) with aliases
  `.remove bg`, `.removebg`, `.bg remove`, `.hapus latar`, `.hapus background`, `.rbg`.
  Send an image with the command or reply to an image to receive a transparent PNG
  processed remotely via the keyless `bgninja.com` API (20 s timeout, strict image
  validation, ❌ react on every failure mode).
- Ephemeral `storage/tmp/bgremove_<uuid>/` file lifecycle: input and output exist only
  for the request lifetime, deleted in `finally` on every path, stale directories swept
  on tool load; `storage/tmp/*` is git-ignored (Rule I).
- Localized `media.bgremove` strings (`no_image`, `too_large`, `api_failed`, `timeout`,
  `invalid_result`, `success`) and `tools.commands.remove_background.description` in
  English and Indonesian; `UTILITY` policy entries; `docs/COMMANDS_CONTEXT.md` section
  so Sara can explain the command.

---

## [G2-F30-P8] - 2026-10-04

### Fixed — deploy script no longer clobbers .env on partial Doppler download

#### Fixed

- `scripts/docker-deploy.sh` now downloads Doppler secrets to a temp file and only replaces `.env` on success. Previously a failed download (restricted secrets in `cosmos:prd`) truncated `.env` mid-deploy, stripping `GROQ_API_KEY`/`OPENROUTER_API_KEY`/`STORAGE_ENCRYPTION_KEY` from the container and breaking every `.ai` request with "Groq API key is not configured."

## [G2-F30-P7] - 2026-10-03

### Changed — standard Markdown for documentation answers

#### Changed

- The OpenRouter documentation route now instructs the model to answer command how-to questions in standard Markdown (headings, lists, `**bold**`, `*italic*`, inline code, fenced code blocks) and to never emit WhatsApp-specific markers (`*bold*`, `_italic_`, `~strike~`, triple-backtick wrappers). Command names and parameters render as inline code.

## [G2-F30-P6] - 2026-10-03

### Fixed — PR #68 review findings on OpenRouter doc routing

#### Fixed

- Laya conversation fast-path no longer swallows command-documentation questions; a heuristic guard lets them reach the Tier 1 planner so `docQuestion` is set correctly.
- Abort timeout in `OpenRouterDocsClient` now covers the response body read, not just the headers; added a 20s overall budget across the candidate chain and explicit timeout vs failure log distinction.
- Docs fast-path guarded to pure conversational briefs with no dispatched tool, so an inconsistent planner brief can no longer swallow a real tool intent.
- Response body drained on non-200 statuses; `usage.include=true` requested for real cost telemetry; doc answers length-capped before WhatsApp delivery; duplicate Tier 1 prompt rule numbering corrected; fallback briefs explicitly set `docQuestion: false`.

## [G2-F30-P5] - 2026-10-03

### Added — OpenRouter documentation routing for Sara AI

Sara AI answers command-documentation questions with the full
`docs/COMMANDS_CONTEXT.md` (~7.5k tokens) embedded in her Groq prompt,
which alone exceeds Groq's per-minute token ceiling when combined with the
persona prompt (HTTP 413). Free OpenRouter models offer a ~262k-token context
window at $0, so this release routes documentation questions through them.

#### Added

- `src/services/agentEngine/openRouterDocsClient.ts` — free OpenRouter docs
  client with an env-overridable candidate chain
  (`OPENROUTER_DOCS_MODELS`, default
  `inclusionai/ling-3.0-flash-sante:free,qwen/qwen3.8-27b:free`), 8-second
  per-model `AbortController` timeout, key resolution via
  `apiKeyResolver.resolveApiKey('openrouter')`, caller-input sanitisation via
  `DecisionClient.sanitizeUntrustedContent()`, Sara-voice system prompt with
  the unbounded documentation wrapped in `<docs>…</docs>`, and status/model/
  latency/token-usage-only logging (never the body or key).
- `docQuestion` boolean on `GuidanceBrief`, populated by the Tier 1 planner
  JSON schema and prompt directives (true for command how-to/what-is/docs
  requests; false for web-search lookups and ordinary chat).
- `processMessage` short-circuit: when `brief.docQuestion` is true, the docs
  client is consulted first; any failure falls through to the existing Groq
  Tier 2 path unchanged (fail-open).

#### Changed

- `.env.example` documents `OPENROUTER_DOCS_MODELS`.

## [G2-F30-P4] - 2026-10-03

### Added — committed MCP client-configuration reference

The MCP client configuration reference for AI coding
agents lived only as untracked files in the stale
`~/cosmos-mcp` worktree (`feat/cosmos-mcp-server-isolated`);
none of it was ever committed to the repository. The
session's repository identity has also been moved to the
main `~/cosmos` checkout on `main`.

#### Added

- `src/mcp/README.md` — client configuration reference:
  single-owner-key model, key export (1Password/Doppler),
  local (stdio) vs remote (Streamable HTTP) usage, SSH
  port-forward guidance, and verification commands.
- `src/mcp/opencode.example.json`, `src/mcp/pi.example.json`,
  `src/mcp/antigravity.example.json`,
  `src/mcp/remote-http.example.json` — copy-paste-ready
  configs for the four supported clients plus the generic
  remote HTTP form. The Pi example is aligned to the
  `mcpServers` array form documented in
  `docs/COSMOS_MCP.md` §8 (the worktree copy used an
  object form that did not match the documentation).
- Fixed a broken relative link in the README
  (`../COSMOS_MCP.md` → `../../docs/COSMOS_MCP.md`).
- `docs/COSMOS_MCP.md` §8 now points at the committed
  example files in `src/mcp/`.

#### Notes

The stale worktree and its branch are removed in this
change; the branch's tracked content was fully superseded
by the squash merge of PR #56 plus subsequent fixes, and
its only unique content (the five files above) is now
committed here.

---

## [G2-F30-P3] - 2026-10-03

### Fixed — `pm2 restart cosmos-mcp` crash loop (EADDRINUSE)

Incident during the `G2-F30-P2` verification: restarting
the MCP process through PM2 orphaned the outgoing process
(reparented to PID 1, still holding `127.0.0.1:4100`),
and every replacement process crashed on bind with
`EADDRINUSE` — 25 restarts before the orphan was killed
manually. `G2-F30-P2`'s `closeAllConnections()` change is
reverted as part of this fix; it correlated with the
incident and provided no proven benefit.

Two root causes addressed:

#### Fixed

- **The replacement no longer crashes on a busy port.**
  `startHttpTransport` now binds through `listenWithRetry`:
  on `EADDRINUSE` it retries with exponential backoff
  (500ms base, 5s cap) for a bounded 60-second window,
  then fails loudly with one clear fatal error instead of
  a crash loop. A restart race now self-heals; a stuck
  port produces one actionable error.
- **Shutdown can no longer hang unbounded.** The graceful
  phase is bounded by a 5-second force-exit timer (unref'd
  so it never holds the process open). A hung session
  cleanup previously forced PM2 to SIGKILL, which is what
  orphaned the process and left the port held.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm run version:check` clean · `tests/cosmosMcp.test.ts`
**54/54** (three new `port bind retry` tests: immediate
bind on a free port, retry-then-bind after the holder
releases, and loud failure after the retry window) ·
in-container after redeploy: `pm2 restart cosmos-mcp`
binds with no `EADDRINUSE`, no crash loop, the endpoint
answers `401` unauthenticated, and exactly one
`MCP_SERVER_STARTED` alert is delivered per restart.

---

## [G2-F30-P2] - 2026-10-03

### Fixed — `pm2 restart cosmos-mcp` crashed once with `EADDRINUSE`

Found while verifying the alert-notifier deploy. Restarting
the MCP process through PM2 made the fresh instance crash
once before binding: the old process's keep-alive
connections held `127.0.0.1:4100` open while the new
instance tried to listen (observed as 2 restarts and an
`EADDRINUSE` stack in the error log).

#### Fixed

- The HTTP shutdown path now calls `closeAllConnections()`
  after closing MCP sessions, so the listener releases the
  port immediately and the replacement process binds
  cleanly.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm run version:check` clean · `tests/cosmosMcp.test.ts`
51/51 · in-container after redeploy: `pm2 restart cosmos-mcp`
produces no `EADDRINUSE`, the endpoint keeps answering
`401` unauthenticated, and exactly one `MCP_SERVER_STARTED`
alert is delivered per restart.

---

## [G2-F30-P1] - 2026-10-03

### Fixed — `MCP_SERVER_STARTED` alert dropped by the PM2 boot race

The first deploy of the alert notifier showed a "IPC bridge
unreachable; alert dropped (MCP_SERVER_STARTED)" warning on
every restart: under PM2 the MCP and bot processes boot
together, and the MCP process can emit its startup alert a
second before the bot's IPC server starts listening. The
alert was permanently lost.

#### Fixed

- `alertServerStarted` now retries a dropped startup alert on
  a bounded schedule (20s, then 60s) with `unref()`'d timers,
  so a pending retry never holds the process open. The
  bot-side dedupe key collapses the attempts into a single
  delivery whenever the first one does get through.
- `alertMcp` now resolves with a delivery boolean (`true` =
  reached the bridge, `false` = dropped) so callers can
  react; all existing fire-and-forget call sites are
  unaffected.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm run version:check` clean · `tests/mcpAlerts.test.ts`
17/17 (delivery boolean asserted for both the reachable and
the dead-bridge paths) · in-container after redeploy: the bot
log shows the `MCP_SERVER_STARTED` console line after a
`cosmos-mcp` restart with no dropped-alert warning.

---

## [G2-F30-P0] - 2026-10-03

### MCP Alert Notifier — MCP events now push to Discord, Slack, and WhatsApp

The MCP surface emits operational and security alerts through the
existing external status channels. Because the WhatsApp transport
needs the bot process's Baileys socket, alerts travel over the
authenticated IPC bridge to a new `/internal/mcp/alert` route in
the bot process, which dispatches them through the regular
`notify()` fan-out — one emit path, all three channels, with
`StatusNotificationLog` persistence and outbox retry.

#### Added

- **Seven new notification events** (registered in the closed
  `NOTIFY_EVENTS` union, so outbox retries accept them):
  `MCP_SERVER_STARTED` (INFO), `MCP_AUTH_REJECTED` (CRITICAL),
  `MCP_RATE_LIMITED` (WARN), `MCP_MUTATION_BLOCKED` (WARN),
  `MCP_MUTATION_APPLIED` (INFO), `MCP_TOOL_ERROR` (WARN),
  `MCP_ENGINE_UNREACHABLE` (CRITICAL).
- **`/internal/mcp/alert` IPC route** — constant-time
  `INTERNAL_IPC_SECRET` authentication like every `/internal/...`
  route, strict validation via a pure `parseMcpAlertRequest`
  (accepts only `MCP_*` events, length-caps every field, rejects
  non-scalar field values), then `notify()` dispatch.
- **`src/mcp/alerts.ts`** — the MCP-side emitter. Fire-and-forget
  by design: alerting never fails a tool call; an unreachable
  bridge drops the alert with a deduped console warning.
- **Hook points:** server startup (`MCP_SERVER_STARTED`),
  authentication rejections with a rolling 5-minute threshold
  counter (3+ rejections within the window raises
  `MCP_AUTH_REJECTED`, re-armed after firing), tool-error
  classification in the central registry catch (rate limits /
  safety-gate blocks / unexpected errors), mutation execution
  audit trail, and IPC transport-layer failures
  (`MCP_ENGINE_UNREACHABLE`).

#### Privacy (Rule AG)

Payloads carry only sanitized, low-cardinality fields — tool
names, error codes, transport, row counts. No credentials, JIDs,
phone numbers, or tool arguments. The channel formatters'
identifier redaction remains the outbound backstop.

#### Delivery semantics

Deduplicated per event class (10-60 minute windows) so a probing
client cannot flood the channels. With the default
`STATUS_NOTIFY_MIN_SEVERITY=WARN`, INFO events are filtered from
the channels but still persisted to `StatusNotificationLog`; set
the variable to `INFO` to receive startup and mutation-applied
alerts.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check`
clean - new `tests/mcpAlerts.test.ts` 17/17 (validator matrix,
threshold counter with fake clock, end-to-end IPC forwarding against
a mock Unix-socket server, never-throws-against-dead-socket) -
`tests/cosmosMcp.test.ts` 51/51 - `tests/statusNotifier.test.ts`
5/5 - MCP stdio smoke 23/23.

Docs: `docs/COSMOS_MCP.md` section 14 (alert surface reference);
`docs/VERSIONING.md` milestone registry row F30.

---

## [G2-F29-P9] - 2026-10-03

### Fixed — every MCP HTTP request failed with `Parse error: Invalid JSON-RPC message`

Found by running the deployed `G2-F29-P8` server end-to-end. With the
entrypoint guard fixed, the HTTP transport finally bound and answered —
but every JSON-RPC request was rejected with a 400 parse error, even a
correctly-formed `initialize`.

#### Root cause

`handleRequest` passed a `ReadableStream` as the third argument to
`StreamableHTTPServerTransport.handleRequest(req, res, body)`. That
third parameter is `parsedBody` — an optional **pre-parsed message
object** for body-parser middleware. When it is defined, the SDK uses
it directly as the JSON-RPC message and never reads the real request
body. A `ReadableStream` is not a JSON-RPC message, so Zod validation
rejected every request before it ever reached the tool surface.

The Node wrapper (`streamableHttp.js`) already converts the Node
`IncomingMessage`/`ServerResponse` pair to web-standard objects via
`@hono/node-server` and reads the body itself — no manual body
plumbing is needed or permitted.

#### Fixed

- Removed the `readBody` helper; `handleRequest` is now called with
  exactly `(req, res)` at both call sites.

#### The test that was missing

No test ever exercised the HTTP transport end-to-end — the smoke suite
covers stdio only, and the unit tests cover auth, parsing, and schema
logic. A real HTTP round-trip would have caught this immediately.
Added a `cosmos_mcp: streamable HTTP transport` suite that starts the
transport on a loopback port and drives the actual protocol:
unauthenticated `initialize` → `401 UNAUTHORIZED_MCP`; authenticated
handshake → `200` with `Mcp-Session-Id`; `tools/list` on the
established session → `200` with the full tool surface; `/healthz` →
`200`.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check`
clean · `tests/cosmosMcp.test.ts` **51/51** (was 48) · MCP stdio smoke
23/23 · in-container after redeploy: authenticated `initialize` returns
`200` with a session id and `cosmos_bot_status` returns live bot data
through the IPC bridge.

## [G2-F29-P8] - 2026-10-03

### Fixed — `cosmos-mcp` restart-looped under PM2 (entrypoint guard missed PM2's argv shape)

The `G2-F29-P7` deploy exposed this: with the HTTP transport now
honoured, the process still never served. It exited cleanly every few
seconds and PM2 restart-looped it (13 restarts in 90 seconds), with a
completely empty error log and zero `[MCP]` lines in the output log.

#### Root cause

The `G2-F29-P7` entrypoint guard tested `process.argv[1]` against the
module path. Under PM2's fork mode, `argv[1]` is **PM2's own wrapper**
(`ProcessContainerFork.js`), not the script — PM2 passes the real script
path via the `pm_exec_path` environment variable instead. The guard never
matched, `main()` never ran, the event loop drained, Node exited `0`, and
PM2 restarted it indefinitely. A silent infinite restart loop with a
healthy-looking status.

#### Fixed

- `isProcessEntrypoint()` now checks both `argv[1]` (direct execution)
  and `process.env.pm_exec_path` (PM2 fork mode).
- New `cosmos_mcp: entrypoint` regression test reproducing PM2's exact
  argv shape (wrapper in `argv[1]`, script in `pm_exec_path`).

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check`
clean · `tests/cosmosMcp.test.ts` **48/48** · MCP stdio smoke 23/23 ·
in-container: PM2 `restarts=0`, log reports
`Streamable HTTP transport listening on http://127.0.0.1:4100/mcp`,
endpoint answers `401 UNAUTHORIZED_MCP` without a key and serves
`cosmos_bot_status` with live data through the IPC bridge when
authenticated.

## [G2-F29-P7] - 2026-10-02

### Fixed — `cosmos-mcp` started on stdio instead of HTTP in production

Found during the `G2-F29-P6` container deploy. The process reported `online`
with a zero restart count and looked completely healthy, while serving nothing.

#### Fixed

- **`--transport=http` was ignored.** `parseTransport` looked for a bare
  `--transport` argument and read the value from the next argv entry. PM2 passes
  `args: '--transport=http'` from `docker/ecosystem.config.cjs`, which arrives as
  a _single_ argv string, so `indexOf('--transport')` returned `-1` and the
  server silently fell back to stdio. Nothing listened on `127.0.0.1:4100`, and
  because the fallback is a valid transport rather than an error, nothing logged
  a problem.

    The parser now accepts both `--transport=http` and `--transport http`, and
    throws on an unsupported value instead of downgrading. A missing value is also
    an explicit error rather than a silent stdio fallback.

- **Importing the entrypoint no longer boots a server.** `main()` now runs only
  when the module is the process entrypoint, so the regression suite can import
  `parseTransport` without starting a transport.

#### Why this escaped review

Four review rounds passed on this code. The defect is only observable when the
argument arrives in PM2's specific form, and `tests/smoke/cosmosMcpSmoke.mjs`
spawned the server directly rather than through PM2, so the equals form was never
exercised. A green suite here meant "the stdio path works", not "both transports
are reachable".

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check` clean ·
`tests/cosmosMcp.test.ts` 47/47 (new `cosmos_mcp: transport selection` suite
covering both spellings, the `--http` alias, the default, and three rejection
cases) · MCP stdio smoke 23/23 · confirmed in-container after redeploy: the log
reports the HTTP transport and the endpoint answers `401 UNAUTHORIZED_MCP`
without a key.

## [G2-F29-P6] - 2026-10-02

### Fixed — separator variants of the group-list and whitelist-all aliases

Reported by the round-4 review (`SUMMARY-v4.md` §5.1) as LOW and pre-existing.
Verified by execution before fixing: the finding was accurate.

#### Fixed

- **`.list-group` and `.list_group` routed to the dashboard instead of the LIST
  branch.** The registry's last-resort stripped index matches separator variants
  by ignoring spaces, hyphens, and underscores, so those spellings reach
  `whitelist.ts` as `['list', 'group']` — the first word only. The alias mapping
  compared `tokens[0]`, so `listgroup` never matched, `subArgs[0]` became
  `group`, and execution fell through to the status dashboard.

    The mapping now compares `stripCommandKey(resolved.commandKey)`, collapsing
    every spelling onto one key:

    ```
    .listgroup  .list-group  .list_group       -> listgroup    -> list
    .grouplist  .group-list  .group_list .group list -> grouplist -> list
    .groups                                          -> groups     -> list
    .whitelistall .whitelist-all .whitelist_all .whitelist all -> whitelistall -> all
    ```

    Two-word aliases that carry their own subcommand now agree with the positional
    path instead of relying on it.

#### Added

- `tests/whitelist.test.ts` covers all eleven separator variants of the list and
  all aliases through the handler-resolved envelope, asserting each routes to its
  own subcommand rather than the dashboard. Verified by reverting the mapping to
  `tokens[0]`: the new assertions fail on `.list-group`, and pass once fixed.

#### Note on a prior review claim

Round 3 (`SUMMARY-v3.md` §3.2) asserted that `.list_group` resolved to subcommand
`list`, derived from reasoning about `normalizeCommandKey` rather than from
observing the token array. It did not: the first word is `list` and the outcome
was the dashboard. The round-3 verdict was unaffected, but its evidence table was
overstated by one spelling.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check` clean ·
`tests/whitelist.test.ts` passes with both new guards ·
`tests/spaced_command_prefix.test.ts` 16/16 groups · `autoarchive`,
`multiword_commands`, `nonspace_commands_and_removed_features`, `menu`, `cancel`,
`monospace`, `idcard`, `job`, `loan`, `versioning` (30), `statusNotifier` (5),
`i18n`, `commandsKnowledge` all pass · `tests/cosmosMcp.test.ts` 46/46 · MCP stdio
smoke 23/23.

---

## [G2-F29-P5] - 2026-10-02

### Changed — cosmetic cleanups from the round-3 review

Round 3 approved PR #56 with no blockers and two optional cosmetic findings.
Both are addressed here; neither was a behavioural change.

#### Removed

- **Unreachable alias mapping in `whitelist.ts`.** The `invokedKey ===
'whitelist all'` comparison added in `G2-F29-P4` can never be true:
  `commandTokens()` always splits the resolved command key on spaces, so
  `tokens[0]` is a single word and two-word spellings arrive positionally
  (`['whitelist', 'all']`) with the subcommand already resolved by
  `subArgs[0]`. Verified across the multiword alias set — `tokens[0]` contained a
  space in 0 of 8 cases. The comment now explains why two-word spellings need no
  mapping, so the omission does not read as an oversight.

#### Documented

- **`commandNameWords`' `activePrefix` parameter.** It is forwarded only on the
  raw-text fallback, and no caller passes it: the message handler always supplies
  `commandName`, so the parameter is never consulted in practice. The JSDoc now
  states this plainly and tells a caller that can genuinely receive raw text from
  a sub-bot with a non-dot prefix to pass it rather than relying on the default.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check` clean ·
`tests/whitelist.test.ts` passes including the two-word alias regression guard ·
`tests/spaced_command_prefix.test.ts` 16/16 groups · full suite sweep and
`tests/cosmosMcp.test.ts` re-run green.

---

## [G2-F29-P4] - 2026-10-02

### Fixed — round-2 review findings on PR #56

Addresses the second `Request changes` verdict (see `SUMMARY-v2.md`): one
blocker regression introduced by the round-1 fix, plus the structural hardening
and documentation corrections requested alongside it.

#### Fixed

- **`.whitelist all` and `.group list` no longer silently no-op.** Both are
  two-word aliases, so the registry resolves them into a single canonical key
  containing a space. `whitelist.ts` inserted that key into its token array
  _unsplit_ — unlike its six sibling tools — so `tokens[0]` became the literal
  string `"whitelist all"`, no subcommand was resolved, and the command fell
  through to the status dashboard. This was a regression introduced by the
  round-1 fix, in the very call sites meant to remove duplicated tokenization.
- **Alias mapping in `whitelist.ts` now compares canonical keys.** The
  `listgroup` / `grouplist` / `groups` / `whitelistall` / `addallgroups`
  mappings run through `normalizeCommandKey`, so hyphen and underscore spellings
  resolve identically to what the registry already treats as equivalent, and
  `whitelist all` maps to the batch subcommand explicitly.
- **`.add whitelist`, `.add-whitelist`, `.del group`, and `.remove whitelist` now
  resolve.** `normalizeCommandKey` maps those spellings to `add whitelist`,
  never to `addwhitelist`, so the previous six-entry set could not match them;
  they parsed to their first word, matched no tool, and did nothing. The set is
  now split into `INLINE_ADD_COMMAND_KEYS` and `INLINE_REMOVE_COMMAND_KEYS`,
  both extended with the spaced spellings, and the message handler dispatches by
  membership instead of three hardcoded string comparisons per family — which is
  what would otherwise have reproduced the same silent no-op.

#### Changed

- **Token-array construction is consolidated into `commandTokens()`**, and
  `commandNameWords()` covers the three tools that need only the command name.
  All seven call sites now share one implementation. Round 1's defect was _dead_
  context fields; round 2's was an _unsplit_ key written while wiring those same
  fields up. Both defects occupied these seven sites, so the construction now
  exists exactly once.
- **Corrected the `allowUnknownPrefix` documentation.** The JSDoc claimed the
  option was "reserved for the sub-bot rendering paths"; no such caller exists.
  It is now described accurately as defensive — no `src/` caller passes it,
  sub-bot prefixes are already handled because the handler passes the active
  prefix explicitly, and the option exists for a future caller that genuinely
  cannot know the prefix in force.

#### Added

- `tests/whitelist.test.ts` now exercises the handler-resolved envelope
  (`commandName` / `argsStr`) for `.whitelist all`, `.group list`,
  `.whitelist list`, `.whitelistall`, `.listgroup`, and `.whitelist status`,
  asserting each resolves to _its own_ subcommand. Every pre-existing case in
  that suite omits the envelope and so exercised only the raw-text fallback,
  which is precisely why the regression was invisible. Verified by
  reintroducing the unsplit key: the new assertions fail, and pass once fixed.
- Inline-command coverage assertions for all ten spellings, including that the
  add and remove families remain disjoint and that their union equals
  `INLINE_COMMAND_KEYS`.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check` clean ·
`tests/spaced_command_prefix.test.ts` 16/16 groups including the 284-command /
6816-invocation sweep · `whitelist`, `autoarchive`, `multiword_commands`,
`nonspace_commands_and_removed_features`, `menu`, `cancel`, `monospace`,
`idcard`, `job`, `loan`, `versioning` (30), `statusNotifier` (5), `i18n`,
`commandsKnowledge` all pass · `tests/cosmosMcp.test.ts` 46/46 · MCP stdio smoke
23/23. `brat` and `tutorials` remain failing on the pre-change baseline, verified
unaffected.

---

## [G2-F29-P3] - 2026-10-02

### Fixed — review findings on the command prefix normalization change

Addresses the `Request changes` verdict on PR #56 (see `SUMMARY.md`): three
high-severity blockers, one medium blocker, and three of the five non-blocking
findings.

#### Fixed

- **Free-text arguments no longer lose internal whitespace.** The handler rebuilt
  the argument remainder with `words.slice(n).join(' ')`, which collapsed every
  whitespace run. Inputs such as `.sara halo     dunia` and
  `` .contact add `John  Doe` `` reached the tool as single-spaced, silently
  corrupting all 38 single-parameter commands and violating Rule AC, whose whole
  purpose is preserving literal monospace text. The remainder is now sliced from
  the original message body via `sliceArgsAfterWords`, so the bytes survive.
- **The shared tokenizer no longer strips leading punctuation from free text.**
  `splitCommandPrefix` treated any leading non-alphanumeric run as a command
  prefix, and six tools run it over raw captions: `#promo` became `promo`,
  `- 5 item` lost its hyphen, and an emoji was consumed — shifting every
  positional index those tools read. Unknown prefixes are now opt-in via
  `allowUnknownPrefix`; the message handler already passes the active prefix, so
  sub-bot prefixes are unaffected. The leading dot run is also consumed
  consistently now, so `...selamat` yields `selamat` rather than `..selamat`.
- **`ToolContext.commandName` and `argsStr` are now consumed.** They were
  declared and populated but read by nothing, while every affected tool
  re-derived its own tokens from raw message text. `brat`, `whitelist`,
  `autoarchive`, `job`, `loan`, `idcard`, and `help` now read the handler-resolved
  envelope through `resolveCommandArgs`, falling back to raw tokenization only
  when invoked outside the message handler. The earlier claim that tools had
  stopped re-deriving arguments was inaccurate; it is true as of this release.
- **Cancellation keywords match narrowly again.** `normalizeCommandKey` folds
  `[-_\s]+` into spaces, which made `-cancel`, `cancel-`, and `_cancel` all
  cancel a live bank transfer, loan application, job selection, or Sticker.ly
  session. Cancellation is a destructive control and now uses
  `normalizeControlKeyword`, which tolerates casing, a detached prefix, and
  whitespace but keeps hyphens and underscores significant.

#### Changed

- **`getMaxCommandWords()` is cached at registry load.** It previously walked
  every tool and alias key on every inbound message in the hot parse path.
- **`MAX_COMMAND_WORDS` no longer truncates the vocabulary.** The clamp was
  applied to the discovered maximum, so an over-long command would become
  silently unreachable with no diagnostic. The registry now reports its true
  maximum and the handler logs a one-time warning when it exceeds the expected
  ceiling of five words.
- **`UNKNOWN_FIELD` is now emitted by the mutation planner.** The code was
  declared in the `McpErrorCode` union and asserted in `AGENTS.md` as the
  anti-hallucination anchor, but had zero throw sites — hallucinated columns
  surfaced as a generic `UNSAFE_MUTATION` with prose blockers. Plans now carry a
  machine-readable `unknownFields` list, and `cosmos_db_apply_mutation` raises
  `UNKNOWN_FIELD` with those fields when a plan is refused for that reason.

#### Added

- Regression coverage for the surfaces the previous sweep never asserted:
  `argsStr` byte-fidelity across multi-space, tab, and monospace input;
  `getCommandWords` behaviour on non-command captions (`#promo`, `- 5 item`,
  emoji, `...selamat`); cancel-keyword acceptance and rejection; and the
  `resolveCommandArgs` envelope. The suite's parser mirror now delegates to the
  same helpers the handler uses, which is why it previously stayed green while
  the handler was collapsing whitespace.

#### Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm run version:check` clean ·
`tests/spaced_command_prefix.test.ts` 15/15 groups including the 284-command /
6816-invocation sweep · `multiword_commands`, `menu`, `cancel`, `monospace`,
`versioning`, `statusNotifier`, `whitelist`, `autoarchive`, `idcard`, `job`,
`loan`, `i18n`, `commandsKnowledge` all pass · `tests/cosmosMcp.test.ts` 46/46 ·
MCP stdio smoke 23/23 · live MCP run confirms `UNKNOWN_FIELD` is returned for an
invented column.

#### Known limitation

`INLINE_COMMAND_KEYS` still covers six spellings; `.add whitelist`, `.del group`,
and `.remove whitelist` parse to their first word and no-op. This matches
pre-change behaviour, so it is a coverage gap rather than a regression, and is
deferred to a follow-up release.

---

## [G2-F29-P2] - 2026-10-02

### Fixed

- **Commands with a detached or irregular prefix now resolve identically to attached ones.**
  Typing `. menu` (a space between the prefix and the command word) previously produced a different
  result from `.menu`. The message handler split the raw text on whitespace and treated the lone
  `.` as the command token, so the real command was misparsed: some commands silently did nothing,
  while others were routed with the wrong arguments. For example `. stiker brat` failed to resolve
  at all and `. bantuan` returned no tool, whereas the attached spellings worked.
- **Unified command normalization across every resolution layer.** Resolution was previously
  re-implemented in several places with subtly different rules, so the same logical command could
  resolve in the message handler but not in the tools registry, the menu service, or the
  deprecation map. Added `src/utils/commandNormalize.ts` as the single source of truth
  (`normalizeCommandKey`, `stripCommandKey`, `isCommandInvocation`, `splitCommandPrefix`,
  `getCommandWords`), and routed `ToolsHandler.getTool`, `menuService.findCommand`,
  `getLegacyCanonical`, and the message handler parser through it.
- **Fixed dotted aliases that were unreachable when written without the dot.** The registry stored
  aliases verbatim, so 47 aliases (`.bantuan`, `.pin`, `.stiker brat`, `.startautocorrect`, and
  others) resolved only in dotted form. The registry is now keyed by canonical command key, with a
  stripped-separator index retained as a last-resort fallback.
- **Tools no longer re-derive arguments by fixed text index.** Tools such as `autoarchive`,
  `whitelist`, `job`, `loan`, `brat`, `idcard`, and `help` sliced the raw message text at a fixed
  offset, which misparsed a detached prefix. They now use prefix-aware tokenization. The handler
  also passes the already-resolved `commandName` and `argsStr` through `ToolContext`; those fields
  became load-bearing in `G2-F29-P3`, see above.
- **Deprecated-command notices no longer misfire on canonical forms.** Legacy lookup keeps hyphens
  significant, so `register-id` is still flagged as deprecated while the canonical `register id` is
  not. Detached and mixed-case spellings (`. addbalance`, `.ADDBALANCE`) now correctly resolve.
- **Cancel keywords tolerate spacing and casing.** `. cancel`, `CANCEL`, and `.batal ` are now
  recognized like `.cancel`.

### Added

- `tests/spaced_command_prefix.test.ts`, covering prefix detachment, casing, separator variants,
  custom sub-bot prefixes, argument integrity, deprecation notices, and fail-closed behavior for
  unknown commands. The suite sweeps the full registered vocabulary (284 commands) across 6816
  invocations and asserts that every spelling resolves to the same tool with the same arguments.

---

## [G2-F29-P1] - 2026-10-02

### Completed the engine-side IPC surface for the Cosmos MCP Server

The milestone commit shipped `src/mcp/` and the read-only database surface, but the
engine half of the bridge — the `/internal/...` handlers the `cosmos_bot_*` tools call —
was still missing from version control, so the server could only ever answer `BOT_OFFLINE`.
This patch lands that half.

#### Added

- **`src/utils/runtimeHealth.ts`** — dependency-free runtime probes (uptime, RSS, event-loop
  lag, last `connection.update`) shared by `connectionManager.ts` and `ipcServer.ts`. Kept
  in its own module because those two already import each other and a third file is the
  only way to share state without an import cycle.
- **`/internal/bot/status`** — connectivity, session count, registration state, uptime,
  memory, and event-loop lag for `cosmos_bot_status`. An unreachable engine still returns
  `BOT_OFFLINE`; no value is ever fabricated (Rule Y).
- **`/internal/bot/reconnect`**, **`/internal/bot/logout`** — operator recovery for a wedged
  socket. Both require an explicit `confirm` in the request body.
- **`/internal/messages/send`**, **`/internal/groups/all`**, **`/internal/subbots/list`** —
  target resolution and single-message delivery, so the MCP server never has to enumerate
  groups or sub-bot instances itself.

#### Changed

- **`/internal/broadcast`** no longer runs an in-memory `setTimeout` loop that died with the
  process. It now delegates to `broadcastService.startBroadcast`, so a multi-hour fan-out is
  persisted in `StatusNotificationOutbox` with a tiered `nextAttemptAt` and survives a restart
  (Rule J). `/internal/broadcast/preview`, `/internal/broadcast/status`, and
  `/internal/broadcast/cancel` expose preview, progress, and cancellation.
- **`startBroadcastWorker()` is started when the IPC server begins listening**, so a restart
  resumes an interrupted fan-out instead of stranding it in `PENDING`.

#### Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`: clean.
- `tests/cosmosMcp.test.ts`: 46/46 pass (11 suites).
- `tests/smoke/cosmosMcpSmoke.mjs`: 23/23 pass over the real stdio protocol.

---

## [G2-F29-P0] - 2026-10-02

### Feature Milestone 29 — Cosmos MCP Server for AI Coding Agents (Issue #49)

A first-party Model Context Protocol server gives AI coding agents — OpenCode, Claude Code,
Pi, and Google Antigravity — typed, guarded, audited access to the Cosmos database, feature
catalogue, and live bot actions. It replaces the recurring pattern where an agent reached for
`npm`, installed an ad-hoc CLI, and wrote a throwaway script (for example
`scripts/broadcast.mjs`) that bypassed every guardrail in `AGENTS.md`.

The motivating request — _"broadcast to all groups with a 5-second delay per group that the
bot will be undergoing maintenance"_ — is now exactly one `cosmos_bot_broadcast` call.

#### Added

- **`src/mcp/`** — the Cosmos MCP server (`@modelcontextprotocol/sdk` with Zod input schemas):
    - `config.ts` — environment-driven configuration and the Rule V loopback-bind guard.
    - `auth.ts` — single-owner key authentication with constant-time comparison and fail-closed
      behaviour; the key never appears in a result, an error, or a log line.
    - `privacy.ts` — JID/phone masking plus ephemeral `contact_ref_...` aliases (3-minute TTL,
      10 000-entry LRU, RAM only) mirroring the zero-knowledge policy of Rules AB and AG.
    - `audit.ts` — sliding-window rate limiter, mutation concurrency ceiling, and `ActivityLog`
      audit writes that record the acting **holder** rather than the credential.
    - `errors.ts` — the stable, machine-readable error-code contract.
    - `sql/guardrails.ts`, `sql/readOnlyDb.ts` — read-only SQLite access on a genuinely
      `readonly` handle, mandatory `LIMIT`, mandatory explicit projection, credential table and
      column denylists, and mandatory `WHERE` on high-value ledgers.
    - `schema/prismaCatalog.ts` — dependency-free parser for `prisma/schema.prisma`; the
      anti-hallucination anchor that reports the live models, fields, defaults, indexes,
      composite constraints, enums, and relations.
    - `schema/mutationPlanner.ts` — the dry-run planner returning `safe`, blockers, the exact
      `prisma.$transaction` boilerplate, the Rule W 3-phase DDL mirror targets, the ACID and
      `balanceAfter` requirements, and a per-rule checklist.
    - `schema/applyMutation.ts` — the executor, gated behind a byte-identical plan fingerprint,
      `prisma.$transaction`, an `ActivityLog` row, a console log line, and a before/after diff.
    - `schema/ddlMirror.ts`, `schema/toolingIsolation.ts`, `schema/i18nAudit.ts` — Rule W dual
      maintenance and 3-phase ordering, Rule X worktree isolation, and Rule O translation parity
      as machine-checkable reports.
    - `tools/dbTools.ts`, `tools/featureTools.ts`, `tools/botTools.ts` — the `cosmos_db_*`,
      `cosmos_*`, and `cosmos_bot_*` namespaces, plus `cosmos_guidance` (the machine-readable
      agent contract and intent → tool map).
    - `server.ts`, `http.ts`, `index.ts` — per-identity server assembly, the loopback-only
      Streamable HTTP transport, and the CLI entrypoint.
- **`cosmos_bot_broadcast` and the rest of `cosmos_bot_*`** — every live bot action is proxied
  over the existing authenticated Unix-socket IPC bridge to the engine that owns the Baileys
  sockets. `BOT_OFFLINE` is returned when the engine is unreachable; nothing is ever
  fabricated (Rule Y).
- **`src/services/broadcastService.ts`** — persisted broadcast fan-out. One
  `StatusNotificationLog` row per job plus one `StatusNotificationOutbox` row per target with a
  staggered `nextAttemptAt`, so a multi-hour run survives a restart (Rule J). Reusing the
  existing status-notification tables means no schema change and therefore no additional Rule W
  dual-maintenance burden. Cancellable through `cosmos_bot_broadcast_cancel` and through
  `.cancel` via `cancellationManager` (Rule N).
- **New IPC routes** — `/internal/bot/status`, `/internal/bot/reconnect`,
  `/internal/bot/logout`, `/internal/messages/send`, `/internal/groups/all`,
  `/internal/subbots/list`, `/internal/broadcast/preview`, `/internal/broadcast/status`, and
  `/internal/broadcast/cancel`.
- **Per-client configuration** — `.mcp.json` (Claude Code) plus `docs/mcp/` examples for
  OpenCode, Pi, Google Antigravity, and the remote HTTP transport. All four clients reference
  the same single owner key; none is committed.
- **`AGENTS.md` §AH**, **`.agents/skills/cosmos-mcp/SKILL.md`**, and **`docs/COSMOS_MCP.md`** —
  the agent contract (no npm, no ad-hoc CLI packages, no throwaway scripts, no direct SQLite
  access), the intent → tool selection map, and the operator/deployment guide.
- **Tests** — `tests/cosmosMcp.test.ts` (46 assertions across authentication, SQL guardrails,
  the schema catalogue, the mutation planner, privacy, rate limiting, the persisted fan-out,
  read-only execution, and read-only tool compilation) and
  `tests/smoke/cosmosMcpSmoke.mjs`, which speaks the real MCP stdio protocol against the real
  server process.

#### Changed

- **`src/services/ipcServer.ts`** — the `/internal/broadcast` handler no longer runs an
  in-memory `setTimeout` loop. It now schedules a persisted job and returns per-target
  receipts, a cancellable job id, and a hard target ceiling. The previous fire-and-forget
  behaviour could silently lose an in-progress fan-out on restart.
- **`src/services/statusNotifier/outboxWorker.ts`** — explicitly skips rows belonging to the
  broadcast scheduler (`event = 'BROADCAST'` or a `broadcast:` channel) so the two schedulers
  never contend for the same row.
- **`src/utils/connectionManager.ts`** — records every `connection.update` timestamp so
  `cosmos_bot_status` can report the last known connection event.
- **`docker/ecosystem.config.cjs`** — new `cosmos-mcp` PM2 app running the Streamable HTTP
  transport on `127.0.0.1:4100`, skipped automatically when the bot build was not packaged.
- **`docker/nginx.conf`** — `/mcp` explicitly returns `404` on the public listener. The MCP
  surface is deliberately not proxied; it is reachable only from a co-located process or an SSH
  tunnel.
- **`.env.example`**, **`README.md`** — documented the new environment variables, the scripts,
  and the MCP surface.

---

## [Unreleased]

### Fixed (health monitor false-positive, found via the improved logging)

- **Heap pressure measured against the V8 heap limit:** the health monitor
  compared `heapUsed` to `heapTotal`, which V8 grows lazily, so a healthy
  process sitting at 232 MB RSS of 8 GB reported a permanent
  `heap usage high (96%)` degraded alert. It now compares against
  `v8.getHeapStatistics().heap_size_limit` (81.5% → 4.7% on the same process),
  which is a genuine pressure signal. RSS remains the primary memory guard.

### Fixed (operability follow-up after the `G2-F28-P4` deploy)

- **Actionable status logs:** `WARN` / `CRITICAL` notifications now print their
  `details` and `fields` on the console line. Previously the console showed only
  "degraded" with no cause, which was undiagnosable when no external status
  channel is configured. `INFO` events remain a single terse line.
- **Named backup failure cause:** `DB_BACKUP_FAILED` now reports the actual
  Telegram API error (for example `Bad Request: chat not found`) and an explicit
  per-channel delivery summary instead of a generic "telegram only" string.

---

## [G2-F28-P4] - 2026-10-02

### Fixed (CodeRabbit re-review on `f51272d`)

- **Backup alert reports the real database path:** the `Database` field in
  `DB_BACKUP_SUCCESS` notifications is now derived from the resolved database
  path (honouring `DATABASE_URL` overrides) instead of a hardcoded
  `storage/database.sqlite` filename. Absolute paths outside the working
  directory are reduced to their file name so no server filesystem layout is
  leaked outbound.

---

## [G2-F28-P3] - 2026-10-02

### Fixed (Review follow-up on PR #55)

- **Unconfigured backups no longer report success:** `runBackupCycle` dispatches
  `DB_BACKUP_FAILED` when no destination is configured while the database has
  changed; success is reserved for real deliveries and genuine
  unchanged-database skips.
- **Artifact opt-in enforced at the exfiltration boundary:** `sendDiscordFile`
  and `sendWhatsAppFile` independently refuse uploads while
  `STATUS_NOTIFY_BACKUP_ARTIFACTS_ENABLED` is off, so no future call site can
  bypass the gate.

---

## [G2-F28-P2] - 2026-10-02

### Fixed (Independent re-review on PR #55)

- **Raw database artifacts now explicit opt-in (default off):** `runBackupCycle`
  uploads the SQLite snapshot to Discord/WhatsApp only when
  `STATUS_NOTIFY_BACKUP_ARTIFACTS_ENABLED=true`. The snapshot contains session
  credentials and financial records — hash/metadata-only alerts are always sent
  regardless.
- **Owner-DM fallback no longer mangles multi-owner lists:** the transport
  resolves the primary owner via `getOwnerNumbers()` instead of collapsing the
  comma-separated `OWNER_PHONE_NUMBER` into one invalid JID.
- **Outbox rows validated before dispatch:** persisted event/severity/channel
  discriminators and payload shape are checked against `NOTIFY_EVENTS`,
  `NOTIFY_SEVERITIES`, and the channel union; invalid rows terminally fail.
- **Rule AF aliases:** dropped the single-token underscore aliases
  `status_notify` / `status_report`; spaced multi-word names remain canonical.

---

## [G2-F28-P1] - 2026-10-02

### Fixed (CodeRabbit review on PR #55)

- **Logout outage alert no longer dropped:** the shutdown `BOT_DOWN` notification
  is awaited with a bounded 5s timeout before `process.exit(1)`.
- **Truthful backup reporting:** `runBackupCycle` reports `DB_BACKUP_FAILED` when
  no snapshot was persisted anywhere (missing hash, or Telegram plus all file
  deliveries failed); unchanged-database skips still report success.
- **Lightweight heartbeat:** the 60s health check no longer runs
  `PRAGMA integrity_check` or hashes the whole database; it reuses the hourly
  guard verdict via a shared database-path resolver.
- **Dedupe contract:** suppressed duplicates return an empty result list instead
  of a fabricated Discord entry.
- **Outbox accounting:** enqueued rows seed `attempts: 1` for the initial failed
  delivery; 429 `retry_after` values are capped at 30s.
- **Sanitization:** `sessionId` is redacted in all three channel renderers;
  WhatsApp file reads are inside the error-handling flow; `unhandledRejection`
  records only and lets the batching worker flush.

---

## [G2-F28-P0] - 2026-10-02

### Feature Milestone 28 — External Status Channel Integration (Issue #47)

A unified `ExternalStatusNotifier` subsystem mirrors operational events from the
logger, health monitor, database guard, backup pipeline, and audit trail to
Discord, Slack, and WhatsApp Channels. Every outbound payload is sanitized (no
raw JIDs, phone numbers, credentials, or message bodies), and the subsystem is
fail-closed: an unconfigured channel is skipped while local console logging
continues. A broken status channel can never take down the bot it monitors.

#### Added

- **`src/services/statusNotifier/`** — new module: `types`, `config`,
  `formatters`, `transports/{discord,slack,whatsappChannel,http}`, `notifier`,
  `outbox`, `outboxWorker`, `healthMonitor`, `dbGuard`, `auditDigest`,
  `issueLogger`, and `index`.
- **Discord transport** — webhook embeds with a 10s timeout, 3-attempt
  exponential backoff, and explicit HTTP 429 `retry_after` handling.
- **Slack transport** — incoming webhook Block Kit with the same resilience
  profile.
- **WhatsApp Channel transport** — plain-text delivery via the live Baileys
  socket with a persistent-outbox fallback and owner-DM fallback; never throws
  into the socket loop.
- **Health monitor** — lightweight 60s heartbeat (file existence, Prisma probe,
  memory, socket state) emitting `STATUS_DEGRADED`, `BOT_DOWN`, and
  `BOT_RECONNECTED` with a 5-minute startup grace window. The expensive
  `PRAGMA integrity_check` runs only in the hourly database guard; the
  heartbeat reuses its cached verdict.
- **Database guard** — startup + hourly `PRAGMA integrity_check` emitting
  `DB_MISSING` / `DB_CORRUPT` CRITICAL alerts, followed by an emergency backup.
- **Audit digest** — daily + on-demand aggregate of `ActivityLog`,
  `BankTransaction`, `Loan`, `UserIpAccessLog`, and `PaymentTransaction` with
  Rp-formatted sums and no raw identifiers.
- **Batched issue-log forwarding** — 5-minute window, deduped and capped at 10
  distinct signatures, file/line citation, build version.
- **Persistent outbox** — Prisma-backed retry queue (`StatusNotificationOutbox`)
  with a cron-driven worker; no in-memory `setTimeout` (Rule J).
- **Operator commands** — owner-only `.status notify` (channel health + test
  ping) and `.status report` (health snapshot + audit digest), with `descriptionKey`
  entries in both `en`/`id` locales.
- **Global error handlers** — redacted `ISSUE_LOG` (CRITICAL) on
  `uncaughtException` / `unhandledRejection` before exit.
- **Documentation** — `docs/STATUS_NOTIFICATIONS.md` runbook and new
  `.env.example` keys.

#### Changed

- **`src/index.ts`** — boots the status subsystem during startup.
- **`src/utils/connectionManager.ts`** — emits bot-down/reconnected/degraded
  events on close, logout, max-reconnect, and open.
- **`src/utils/backup.ts`** — `runBackupCycle()` reports backup outcome to the
  external channels and delivers the raw SQLite snapshot to Discord (multipart)
  and WhatsApp (document) where supported; the existing Telegram upload is
  unchanged.
- **`prisma/schema.prisma` + `src/db.ts`** — added `StatusNotificationLog` and
  `StatusNotificationOutbox` models and symmetric 3-phase programmatic DDL
  (Rule W).

---

## [G2-F27-P1] - 2026-10-02

### Fixed

- **Security (command injection):** All shell-string concatenation of the user-controlled
  URL removed — `ytdl` and `pinterestdl` now use `execFile` with discrete argv elements
  instead of `exec` with interpolated shell strings, so URLs containing `$(...)` or
  backticks can no longer execute arbitrary commands.
- **i18n mustache artifacts:** `error_unknown_flag_*` cards no longer render raw
  `{{#flags}} {{/flags}}` Handlebars section syntax; unknown flags are now interpolated
  as `` `--flag` `` in both English and Indonesian.
- **Pinterest `--audio` silently broken:** removed the double-quoted FFmpeg binary path
  (`""/path/ffmpeg""`) that prevented every extraction from running.
- **Pinterest `--audio` on GIFs:** audio extraction is skipped for GIF assets (no audio
  track), and a localized "no audio stream" note is delivered instead of failing.
- **TikTok caption note ordering:** the media card is now built after asset acquisition,
  so the "no soundtrack available" note actually reaches the delivered caption, and the
  media-class label resolves through `ctx.t()` instead of leaking the raw i18n key.
- **YouTube codec pinning restored:** `-S vcodec:h264,acodec:m4a` selector re-applied so
  downloads stay WhatsApp-playable MP4/AAC instead of possibly-VP9 webm/mkv.
- **YouTube quality fallback respects ceiling:** `--360` can no longer ship a 4K stream via
  the uncapped `/bestvideo` fallback; both branches keep the requested height ceiling, and
  the misleading `--merge-output-format` on a video-only stream is gone.
- **AutoDL audio regression fixed:** AutoDL-triggered yt-dlp downloads now pass
  `withAudio: true` so merged video+audio streams are delivered again; the dead `quality`
  argument is removed. Explicit `.youtube dl` remains video-only by design.
- **Monospace-wrapped flags honored:** `` `--audio` ``, `"--video"`, and quoted flags are
  unwrapped before tokenization, and backticks/quotes can no longer leak into extracted
  URLs (Rule AC compliance).
- Indonesian mixed-language string `note_single_photo_from_carousel` cleaned up.

---

## [G2-F27-P0] - 2026-10-01

### Feature Milestone 27 — Dynamic Multi-Platform Downloader Suite

A complete overhaul of the downloader subsystem into a parameter-driven suite with full
Indonesian/English parity, a dedicated tutorial menu, and updated AI agent context.

#### TikTok Downloader (`.tiktok dl` / `.tt dl`)

- **Dual operating modes.** Automatic mode (bare link or AutoDL) now delivers the natural
  payload for the post plus its original soundtrack: video posts send a clean MP4 plus MP3,
  single-photo posts send the high-resolution photo plus MP3, and carousel posts send every
  photo back-to-back (so WhatsApp groups them into a native album) plus MP3.
- **Custom parameter mode.** `--audio`, `--video`, `--photo`, and `--multi-photo` select
  exactly what is delivered, in any position relative to the link.
- **Validation matrix.** Conflicting selectors (`--video --photo`, `--video --multi-photo`,
  `--photo --multi-photo`) and content mismatches (requesting video on a photo post, or
  photos on a video post) return formal localized guidance cards. Unknown flags such as
  `--vid` or `--music` are rejected with a syntax card listing the valid parameters.
- Removed the FFmpeg slideshow synthesis that previously re-encoded carousel photos.

#### YouTube Downloader (`.youtube dl` / `.yt dl`)

- **Video-only by default.** Downloads the video stream without audio, avoiding the
  WhatsApp 15 MB limit that merged streams frequently hit.
- **Custom resolutions.** `--360`, `--480`, `--720`, `--1k` (1080p), `--2k` (1440p), `--4k`
  (2160p), and `--best`.
- **Dedicated audio command.** `.youtube dl audio <url>` extracts an MP3 with
  `--128k`, `--192k`, `--320k`, or `--best` bitrate flags.
- Cross-stream flags are rejected with guidance instead of being silently re-routed.

#### Pinterest Downloader (`.pinterest dl` / `.pin dl`)

- Auto-detects single photos, videos, animated GIFs, and multi-photo carousels.
- Multi-photo pins are dispatched sequentially with no delay or interleaved text so
  WhatsApp renders them as one native album card.
- Audio extraction is now opt-in via `--audio`; the redundant secondary document upload
  that cluttered chats has been removed.

#### Decommissioned: Telegram User Commands

- Removed the user-facing `.telegram dl`, `.tg add`, `.tg del`, and `.tg list` commands and
  their tool modules, plus their AutoDL dispatch, AI policy entries, Groq tool registry
  entries, legacy command mappings, and tutorial references.
- **Preserved:** `src/utils/telegramClient.ts`, `src/tgpair.ts`, `src/utils/backup.ts`,
  the `TelegramPrivateChat` Prisma model and its database helpers, the `TELEGRAM_*`
  environment configuration, and the `tg`/`telegram` AutoDL platform keys (so existing
  settings rows keep validating).

#### Shared Infrastructure

- New `src/utils/downloaderArgs.ts` flag-parsing engine used by all three downloaders.
- New `tests/downloader_suite.test.ts` covering flag parsing, conflict detection,
  content-mismatch validation, YouTube format mapping, alias resolution, tutorial
  resolution, and Telegram decommissioning.
- `docs/COMMANDS_CONTEXT.md` Section 6 rewritten for the new commands and parameters.

---

## [G2-F26-P1] - 2026-10-01

### Security

- **Model-Controlled Confirmation Bypass (CWE-693, high severity).** `_confirmed` is the flag a
  tool reads to skip interactive confirmation, but it arrived inside the model-controlled argument
  bag. Because the tool JSON schemas do not declare `additionalProperties: false` and Groq does not
  enforce it, an undeclared key survives `AgentSchemaNormalizer.normalizeTool` intact, so a model
  that hallucinated the field — or was steered into emitting it by prompt injection — could satisfy
  the confirmation gate and run a mutating action with no `.confirm` prompt. Reproduced locally: a
  group member was removed via `group_moderation` with the flag smuggled into the tool-call
  arguments.
    - Added `AgentSchemaNormalizer.stripReservedFlags` and `RESERVED_CONTROL_FLAGS`, applied at the
      trust boundary in `AgentExecutionLoop` before the arguments reach `tool.execute()` or
      `AgentConfirmationManager.stageAction()`. The sanitised bag is used for both the unconfirmed
      execution and the staged re-entry, so a smuggled flag can neither take effect now nor be
      replayed after the user confirms. The trusted re-entry path remains the only writer of
      `_confirmed`, and is documented as such.
    - The `tools/bank.ts` `withdraw` / `transfer` gate shares the same read of `args._confirmed` and
      is now covered by the same fix, closing the pre-existing instance of this weakness.
    - The `[TIER2_EXEC]` log now prints the sanitised arguments so a smuggled flag cannot even
      appear in the audit trail.

### Fixed

- **Raw `{{placeholder}}` leaking to end users.** `tools.group_invite.error`,
  `tools.group_promote.error`, and `tools.group_demote.error` were called without the `phone` /
  `target` variable their templates interpolate, so a failure path rendered the literal
  `{{phone}}` / `{{target}}` to the user. All three call sites now supply the masked identifier.
- **Unguarded `msg` dereference.** `resolveTargetJid` dereferenced `msg.message` without a guard,
  which would throw if a `WAMessage` ever arrived malformed. Added a null check in the shared
  helper (covering every `.group *` command) and an optional chain at the agent call site.
- **Non-deterministic test aborting the agent-engine suite.** Test 16 (`.contact add` monospace)
  used the alias `Ls Friends`, which the LLM-backed contact-name validator rejects as implausible.
  The assertion therefore depended on model output and aborted the suite before Test 17 could run,
  leaving the added tests unexercised. Switched to an alias the validator accepts, preserving the
  test's actual purpose (spaced-alias monospace parsing).

### Added

- **`pnpm validate:i18n` now detects missing interpolation arguments.** `scripts/check-i18n-usage.ts`
  previously verified only en/id catalogue parity and key existence, so it could not catch the
  `{{placeholder}}` class of defect — which is why the defect above survived a green check. It now
  resolves each template's `{{variables}}` and compares them against the object literal supplied at
  every call site, reporting any variable the template needs but the call site omits. The argument
  extractor tracks nested calls, objects, arrays, strings, and template literals so it does not
  misread a nested expression as a property name, and it returns "unknown" for syntax it cannot
  resolve statically (spread, computed keys), skipping those call sites rather than reporting a
  false positive. The new check caught two further real instances (`group_promote.error`,
  `group_demote.error`) beyond the three identified in review.

### Tests

- **Test 18 — confirmation-bypass regression.** Asserts at three levels that a model-supplied
  `_confirmed: true` cannot skip confirmation: the sanitizer strips it and leaves the caller's
  object untouched; an end-to-end run through the real `AgentExecutionLoop` with a stubbed model
  that smuggles the flag stages the action instead of executing it and records no flag in the
  staged arguments; and the trusted `.confirm` re-entry still executes afterwards.
- **Test 19 — placeholder-leak regression.** Drives the `invite` and `blacklist_remove` failure
  paths and asserts no raw `{{placeholder}}` appears in the user-facing error.

---

## [G2-F26-P0] - 2026-10-01

### Added

- **Cosmos Agent Engine Integration (Sara AI) for Group Moderation (Issue #48, sub-issue of #46):**
    - **Milestone F26 — Natural-Language Group Administration.** Registered the Group Moderation System (Issue #46) with `CosmosAgentEngine` so Sara AI can perform group administration on a group admin's behalf. The `.group *` dot-prefixed commands remain fully available for scripted use.
    - Introduced a single `group_moderation` agent tool with an `action` discriminator covering all fourteen moderation actions (`kick`, `close`, `open`, `invite`, `get_link`, `approve`, `reject`, `promote`, `demote`, `rename`, `description`, `blacklist_add`, `blacklist_remove`, `blacklist_list`) instead of fourteen separate tools, preserving the one-tool Tier 2 scope limit enforced by `AgentToolRegistry.getScopedGroqTools`.
    - Cleared all four reachability blockers: added `group_moderation` to `POLICY_MAP` as `CONFIRMATION_REQUIRED`, registered the tool in `AgentToolRegistry.ensureInitialized()`, listed the tool and its full action map in the Tier 1 guidance prompt candidate list, and kept the agent-side name snake_case (`group_moderation`) so it survives `AgentSchemaNormalizer.sanitizeFunctionName` while the bot-side command names stay spaced per Rule AF.
    - Re-derived the caller's admin status inside `execute()` through `ModerationService.isUserAdmin` rather than trusting `SaraPromptContext.isGroupAdmin`, which is deliberately not propagated into `AgentExecutionContext`. This keeps the agent path on the exact same LID/JID-aware identity resolution as the dot-prefixed commands (Rule E) and correctly honours the group-creator short circuit.
    - Derived the target group exclusively from `ctx.chatJid` and never from model output, so no group JID, phone number, or participant identifier reaches the LLM and no `EphemeralTokenStore.mintToken` call site needed widening (Rule AB zero-knowledge).
    - Staged every mutating action through `requiresConfirmation` / `confirmationPrompt`, wiring it into the existing two-phase `.confirm` flow and `.cancel` integration in `AgentConfirmationManager` with no bespoke machinery. Guard rails are re-evaluated on the confirmed re-entry, so admin status is validated against live group metadata at execution time (TOCTOU protection).
    - Routed every user-facing string through `ctx.t` using the existing `tools.group_*` catalogs plus a new `tools.agent_moderation` confirmation and error block in both `en` and `id` (Rule O, Rule H).
    - Delivered identifier-bearing read-only payloads (group invite link, blacklist roster) directly to the originating chat and handed the ReAct loop only a short acknowledgement, so participant phone numbers are masked out of the model context entirely.
    - Normalized model-supplied phone input through the shared `cleanPhoneNumber` multi-token sanitizer (Rule AB), so `0812-3456-7890` resolves to `6281234567890`.
    - Added a code-enforced Tier 1 policy gate in `AgentGuidancePlanner` that discards a `group_moderation` plan when the chat is not a group or the caller is not a group admin, mirroring the guard inside the tool so a misfiring planner never burns a Tier 2 turn.
    - Documented the complete `.group *` command surface and the natural-language `.sara` path in `docs/COMMANDS_CONTEXT.md` so Sara can answer grounded questions about group moderation.

---

## [G2-F25-P2] - 2026-10-01

### Refactored

- **Moderation Identity Resolution Consolidation:**
    - Extracted duplicated User-table and group-participant identity resolution logic in `ModerationService.isBlacklisted` and `ModerationService.removeFromBlacklist` into a unified `resolveIdentityConditions(groupJid, targetJid, providedMetadata?)` helper.
    - Reused already-fetched group metadata across multiple participant checks in `BlacklistEnforcer` to eliminate redundant WhatsApp group metadata network requests per join event.

---

## [G2-F25-P1] - 2026-09-30

### Fixed

- **Sub-bot Database Isolation & Schema Bootstrap (Rule U & Rule W):**
    - Passed active `sessionId` to `BlacklistEnforcer.startListening(sessionId)` and wrapped participant event handling inside `dbContext.run({ sessionId, prisma: getPrismaClient(sessionId) }, ...)` to eliminate context leaks to the default database.
    - Added `GroupBlacklist` and `ModerationLog` table wipes to sub-bot template database initialization in `src/db.ts`.
    - Bootstrapped programmatic SQLite DDL schema via `ensureDatabaseSchema(targetDbPath)` unconditionally for all sub-bot sessions to ensure legacy/pre-existing sub-bot databases possess `GroupBlacklist` and `ModerationLog` tables.
- **Blacklist Authorization & Baileys LID Identity Resolution (CWE-863):**
    - Enhanced `BlacklistEnforcer` and `ModerationService.isBlacklisted` to cross-resolve participant identities across candidate IDs (`id`, `phoneNumber`, `lid`), `prisma.user` records, and group metadata.
    - Verified `kickMember` outcome in `BlacklistEnforcer` to suppress false removal announcements on kick rejection or failure.
    - Routed internal cascading kicks in `addToBlacklist` through `SYSTEM` caller to bypass interactive 3-second operational cooldowns while preserving caller attribution in reason logs.
- **Baileys Return Status Verification:**
    - Inspected per-participant response status arrays from Baileys `groupParticipantsUpdate` and `groupRequestParticipantsUpdate` across `kickMember`, `promoteAdmin`, `demoteAdmin`, `approveJoinRequest`, `rejectJoinRequest`, and `approveAllJoinRequests`, treating non-`200` statuses as actionable failures.
- **UX & Internationalization (Rule O):**
    - Localized auto-kick removal notices in `BlacklistEnforcer` using `tools.group_blacklist_add.auto_removed`.
    - Added `core.rate_limited` translations in English and Indonesian and handled `RATE_LIMIT_EXCEEDED` across all 13 moderation tools.

---

## [G2-F25-P0] - 2026-09-30

### Added

- **Group Moderation System (Milestone F25 — GitHub Issue #46):** Comprehensive group moderation suite empowering group administrators with automated protections, join-request processing, participant control, metadata editing, and a group blacklist system.
    - **Core Moderation Commands:**
        - `.group kick` / `.gkick`: Remove a non-admin member from the group with permission guards preventing removal of admins, self, or creator.
        - `.group close` / `.gclose`: Lock group to admin-only messaging mode via Baileys `announcement` setting.
        - `.group open` / `.gopen`: Re-open group to all members via Baileys `not_announcement` setting.
        - `.group invite <phone>` / `.ginvite`: Send direct message invitations with WhatsApp-native Markdown card containing group invite link to avoid direct-add anti-spam detection.
        - `.group link` / `.glink`: Retrieve the current group invite link.
        - `.group promote <target>` / `.gpromote`: Grant admin privileges to a group member.
        - `.group demote <target>` / `.gdemote`: Revoke admin privileges from an admin with superadmin/creator protection.
    - **Group Metadata & Information Commands:**
        - `.group rename <name>` / `.grename`: Update group subject (1–25 characters).
        - `.group description <desc>` / `.gdesc`: Update group description (1–512 characters) with multi-source input fallback supporting inline text, quoted message text, and `.txt`/`.md` document attachments up to 100 KB.
    - **Join Request Approval & Queue Management:**
        - `.group approve <phone|all>` / `.gapprove`: Approve pending membership approval requests for a specific phone number or bulk-approve all requests sequentially with a 3-second rate limit.
        - `.group reject <target>` / `.greject`: Decline pending membership requests.
    - **Group Blacklist System & Participant Auto-Enforcement:**
        - `.group blacklist add <target> [reason]` / `.gbl add`: Add a user to the group blacklist and immediately kick them if currently in the group.
        - `.group blacklist remove <target>` / `.gbl remove`: Remove a user from the group blacklist.
        - `.group blacklist list` / `.gbl list`: View all active blacklisted users for the group.
        - `BlacklistEnforcer`: Background listener on `group-participants.update` event (`action === 'add'`) that automatically kicks blacklisted users upon joining and alerts the group with green mentions.
    - **Database Persistence & SQLite Migrations:**
        - Added `GroupBlacklist` and `ModerationLog` models to `prisma/schema.prisma` with indexes and unique constraints.
        - Programmatic DDL auto-bootstrap in `src/db.ts` following SQLite migration precedence.
    - **Rate Limiting & Safety Invariants:**
        - Enforced 3-second operational cooldown on group-level moderation actions to comply with WhatsApp API rate limits.
        - Best-effort audit logging of moderation actions to `ModerationLog`.
    - **Internationalization (i18n):**
        - Added symmetric English (`src/locales/en/tools.json`) and Indonesian (`src/locales/id/tools.json`) translations for all 14 tools and their `tools.commands.<name>.description` keys.

---

## [G2-F24-P12] - 2026-09-30

### Fixed

- **Database identity lookup for online members:** Added database query against `prisma.user` in `check_online.ts` when participant LIDs cannot be resolved via group metadata alone. Resolves member pushnames and phone JIDs so registered users and previous bot callers are recognized and displayed with their names rather than falling back to `Anggota Anonim`.

---

## [G2-F24-P11] - 2026-09-30

### Added

- **Group check online command (`.check online` / `.cek online`):** Added a new group utility command listing members currently observed as online by the bot with real-time presence. Includes group-only enforcement, deduplicated bot identity filtering, green mentions via `formatMentions`, per-sender 30s cooldown with expiry pruning, and WhatsApp-native markdown formatting.
- **New agent skill `parallel-branch-versioning`:** Documents parallel-branch version collision detection with `--against origin/main`, mandatory rebase-then-rebump procedure, and Feature Milestone (`F`) milestone counter semantics.
- **Collision detection & strict ref verification:** Added `--against <ref>` flag to `scripts/version.ts verify` and `.github/workflows/version-policy.yml` to catch collisions at PR time rather than post-merge, and enforced strict ref checking against missing base commits.
- **Release tag validation:** Added workflow step in `.github/workflows/docker-publish.yml` verifying that `github.ref_name` strictly matches canonical `version.json`.

### Security

- **Runner command injection defense:** Refactored `git()` and `gitSucceeds()` in `scripts/version.ts` to execute Git using `execFileSync` argument arrays rather than shell interpolation. Exported `BASE_REF` safely via environment variables in `.github/workflows/version-policy.yml`.

### Fixed

- **AI Agent runtime policy:** Registered `'check online'` and `check_online` in `AgentToolPolicyManager` with underscore/space normalization so Sara AI can access the tool.
- **Presence cache persistence:** Added debounced `scheduleSave()` calls in `presenceService.ts` when stale records flip to offline, maintaining parity with disk storage.
- **Cooldown key robustness:** Guarded `senderJid` in `check_online.ts` with fallback to `msg.key.participant` and `msg.key.id` to prevent group-wide lockouts on unresolvable sender identity.
- **LID mention handling:** Resolved participant LIDs to phone numbers via `resolveId` before constructing green mentions in `check_online.ts`, falling back gracefully to pushnames to prevent broken `@lid` mentions.
- **Release automation:** Fixed `scripts/release.ts` `--dry-run` to compute bumped versions in-memory without disk side-effects, filtered flag operands from `--date` and `--bump`, and corrected stable release notes labeling.
- **Docker layer caching:** Moved `COPY version.json` in `docker/Dockerfile` after `pnpm install` to avoid busting layer caches on patch bumps.
- **Documentation & types:** Corrected `args: string[]` type signature in `tests/versionCollision.test.ts`, updated `README.md` badge to `G2-F24-P11`, and relocated `Overview` to the top of `docs/VERSIONING.md`.

---

## [G2-F24-P7] - 2026-09-30

### Changed

- **Cosmos Dated Versioning (`G-F-P`):** Migrated the framework from the legacy `RF-YYMM-BUILD` (pre-release) plus SemVer (stable) split to a single dated version format `G<generation>-F<featureMilestone>-P<patch>`, with an optional `.YYYY-MM-DD` release-date segment and an optional `-alpha|-beta|-rc1|-stable` status segment.
- **Centralized Version Metadata:** Added `version.json` at the repository root as the single source of truth for `version`, `generation`, `featureMilestone`, `patch`, and `releaseDate`, so CI/CD pipelines, release automation, and runtime logging can all read the version without parsing Markdown or Git tags.
- **`src/utils/versioning.ts`:** Added a centralized utility exposing `getVersionInfo`, `formatVersion`, `parseVersion`, `isValidVersion`, `bumpVersion`, `compareVersions`, `serializeVersionFile`, `validateVersionFile`, `formatDatedVersion`, and `describeVersion`, with invariant validation and descriptive errors.
- **`scripts/version.ts`:** Added a CLI for version metadata management, exposed as `pnpm run version:show`, `pnpm run version:check`, and `pnpm run version:bump <patch|feature|generation>`.
- **`scripts/release.ts`:** Rewritten around `version.json`. It reconciles `package.json`, validates the `CHANGELOG.md` header, and supports `--bump <patch|feature|generation>`, `--stable`, `--dry-run`, and `--no-push`.
- **CI:** `.github/workflows/docker-publish.yml` now triggers on tags matching `G[0-9]*-F[0-9]*-P[0-9]*` and validates `version.json` before building the image.
- **Documentation:** Rewrote the versioning section of `README.md`, AGENTS.md Rule S, and the Job and Salary System skill; added `docs/VERSIONING.md` and the new `cosmos-versioning` agent skill.
- **Runtime Reporting:** The startup banner in `src/index.ts` and the `.stats` telemetry card now report the Cosmos version read from `version.json` instead of an implicit `package.json` value. The `Cosmos Version` label was added symmetrically to `src/locales/en/tools.json` and `src/locales/id/tools.json`.

### Notes

- Legacy `RF-*` changelog headers and Git tags are retained unchanged as historical pre-release records and must not be rewritten.
- Version tags no longer use a `v` prefix and the framework no longer publishes SemVer releases.

---

## [RF-2609-21] - 2026-09-29

### Added

- **Group Tagging for Encrypted Contact Book (`src/tools/contact.ts`, `src/services/contactService.ts`):**
    - `.contact add <alias> @tag` now saves a contact by tagging someone directly in a group, so users no longer need to transcribe a phone number manually.
    - Added `parseContactAddArgsWithMention` and `stripMentionTokens` to read the authoritative target from `contextInfo.mentionedJid` and strip the `@<digits>` literal WhatsApp renders in the text body, treating the remaining words as the alias.
    - Added `resolveMentionedContact` in `src/services/contactService.ts` to map a mention target to a canonical storable JID, reading the tagged participant's push name from group metadata for display and default-alias purposes.
    - Bare `.contact add @tag` form supported: when no alias is supplied, the tagged participant's WhatsApp display name is used as the alias.
    - Monospace and quoted aliases continue to work alongside a tag (e.g. ``.contact add `Ls Friends` @tag``), consistent with Rule AC.

### Changed

- **LID-Safe Mention Resolution:** A mention target may arrive as a phone JID or, on modern WhatsApp builds, as an opaque `@lid` identifier. `resolveMentionedContact` maps the LID back to its phone JID through the shared `lidToPnMap` cache and, when still unresolved, by scanning the group participant list. An unmappable LID is still accepted because Baileys can address and mention a participant by LID directly, ensuring tagged contacts resolve correctly in LID-only groups.
- **Contact Source Transparency:** The `.contact add` confirmation now reports whether the contact was saved from a tagged participant or a phone number.

### Changed (Repository Maintenance)

- **Dependency Pruning (`package.json`, `pnpm-lock.yaml`):** Removed unused dependencies `@img/sharp-wasm32` and `i18next-fs-backend`, and synchronized the documented tech stack in `AGENTS.md` and `README.md` accordingly.
- **Docker Build Disk Optimization (`.github/workflows/docker-publish.yml`, `scripts/docker-*.sh`):** Improved layer cache cleanup and disk space pruning in the build and deploy scripts to reduce `no space left on device` extraction failures.
- **Group Moderation Plan Relocation:** Moved the group moderation design plan into issue #46 and removed the now-redundant `MODERATION_PLAN.md` from the repository tree.

---

## [RF-2609-20] - 2026-09-26

### Added

- **Laya AI System One Decision Engine Integration (Issue #41, PR #42, Rule AG):**
    - **Zero-Knowledge Decision Client (`src/services/agentEngine/decisionClient.ts`):** Implemented client utility with `sanitizeUntrustedContent()` to scrub raw phone numbers (`+62...`, `08...`), WhatsApp JIDs (`@s.whatsapp.net`, `@g.us`, `@lid`), and Rupiah balances (`Rp...`), mapping known contact and group aliases to ephemeral RAM nonces (`contact_ref_...`) before dispatching payloads.
    - **Fast-Path Intent Classification (`src/services/agentEngine/guidancePlanner.ts`):** Integrated single-pass non-autoregressive intent evaluation in Tier 1 Guidance Planner, short-circuiting conversational turns without recipients (`confidence >= 0.85`) to reduce latency before falling back to Groq LLM candidate chains.
    - **Advisory Credit Underwriting Signals (`src/services/loanService.ts`):** Integrated non-autoregressive credit risk assessment into `assessLoanWithAI` with strict dual-gate code bounds enforcing 2%–15% interest rates, 7–30 day tenors, and ACID `$transaction` execution with memory mutexes.
    - **Circuit Breaker & Fallback Architecture:** Enforced 3-second hard timeouts (`AbortController`) on outbound calls with graceful fallback to Groq Native Function Calling or deterministic scoring tiers without stalling the Baileys event loop.
    - **Governance & Standards:** Added `AGENTS.md` Rule AG and dedicated specialized agent skill guide in `.agents/skills/laya-ai-decision-engine/SKILL.md`.
    - **Automated Test Coverage (`tests/decisionClient.test.ts`, `tests/loan.test.ts`):** Added unit and contract tests verifying zero-knowledge sanitization, offline gateway fallback resilience, and whitelisted group loan setups.

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

[Unreleased]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-21...HEAD
[RF-2609-21]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-20...RF-2609-21
[RF-2609-20]: https://github.com/razaelmahasaputra/cosmos/compare/RF-2609-19...RF-2609-20
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
