# Cosmos Feature Limit System — Design Specification

**Status:** Implemented via Issue #72 — enforcement in PR #73, pricing surface in PR #74, API copy note in PR #75.

A per-feature usage limit system that protects server resources (ffmpeg, sharp, yt-dlp, Groq
LLM calls) by capping how often each command may be invoked, per user, within a time window.
**The cap is not a global constant: it follows the subscriber's plan**, so Pulse (free) users are
throttled the hardest and Zenith (partner) users the least — the same plans the website already
sells on `/pricing` and the same resolver the bot already uses for group and sub-bot quotas.

This document is the specification. Implementation belongs in `src/tools/`, and every rule in
[`AGENTS.md`](../AGENTS.md) still applies.

---

## 1. Why it exists

Several Cosmos commands consume scarce server resources:

| Feature          | Cost driver                    | Handler                                           |
| :--------------- | :----------------------------- | :------------------------------------------------ |
| Sticker maker    | ffmpeg, animated WebP encoding | `src/tools/sticker_maker.ts`                      |
| Brat sticker     | sharp, animated rendering      | `src/tools/brat.ts`                               |
| YouTube download | yt-dlp + ffmpeg process spawn  | `src/tools/ytdl.ts`, `src/tools/play.ts`          |
| TikTok download  | remote fetch + transcode       | `src/tools/tiktokdl.ts`                           |
| Pinterest dl     | ffmpeg                         | `src/tools/pinterestdl.ts`                        |
| AI / LLM         | Groq tokens, latency           | `src/services/ai.ts`, `src/services/agentEngine/` |
| Speech-to-text   | Groq Whisper upload            | `src/tools/stt.ts`                                |
| Web search       | Tavily quota                   | `src/services/agentEngine/tavilyClient.ts`        |

Without a limit, one user looping `.sticker` or `.play` can saturate the CPU and drain the Groq
quota for everyone. The bot needs a cheap, uniform way to say _"wait a moment."_.

---

## 2. Current state (the problem being solved)

Rate limiting in Cosmos today is **hand-rolled per feature**, with no shared abstraction:

| Mechanism                              | Location                                  | Storage       |
| :------------------------------------- | :---------------------------------------- | :------------ |
| Anti-spam message guard                | `src/utils/security/antiSpamGuard.ts`     | in-memory     |
| Agent (Sara AI) sliding window         | `src/services/agentEngine/rateLimiter.ts` | in-memory     |
| Subscription quotas (groups, sub-bots) | `src/services/quotaService.ts`            | Prisma DB     |
| Moderation action throttle             | `src/services/moderationService.ts`       | in-memory     |
| `check_online` cooldown                | `src/tools/check_online.ts`               | in-memory     |
| Daily claim cooldown                   | `src/tools/daily.ts`                      | `User` column |
| Work shift cooldown                    | `src/services/jobs.ts`                    | `User` column |

There is **no generic per-feature usage counter**: no `FeatureUsage`, `*Quota`, or `*Usage`
model exists in `prisma/schema.prisma`, and no command declares a reusable limit. Adding a
limit to a new tool today means writing another bespoke `Map` or another `User` column.

---

## 3. Design decision

> **A per-feature sliding-window counter, declared on `ToolDefinition`, enforced at the single
> execution funnel `ToolsHandler.execute()`, with the ceiling resolved from the subscriber's
> plan. Counters are in-memory, not database-backed.**

Four properties make this the right shape:

1. **One choke point already exists.** Every command — current and future — passes through
   `ToolsHandler.execute()` in `src/tools/handler.ts`. Declaring the limit on the tool
   definition and checking it there covers every tool with one edit, instead of one edit per
   handler.
2. **In-memory is correct for the goal.** The objective is protecting the CPU and the Groq
   quota, not billing users. A counter that resets on restart is acceptable: a restart is rare,
   and a lost counter merely grants one fresh budget.
3. **The limit is declarative.** A tool author states a policy
   (`limit: { max: 5, windowMs: 600_000 }`) and never writes timing logic.
4. **The limit is plan-aware for free.** The value is read from the subscriber's existing plan
   through `QuotaService.getUserQuota()` (`src/services/quotaService.ts:49`) — the resolver the
   website dashboard, `.my plan`, and `.my quota` already use. A limit can therefore never
   disagree with what the pricing page promises, because both read the same tier.

### 3.1 Alternatives considered and rejected

| Alternative                         | Why rejected                                                                                                                                                                                                                                                 |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Charge `User.balance` (economy)** | Prices usage instead of capping concurrency, distorts game balance, and forces `$transaction` + confirmation + i18n work under Rule P. Wrong tool.                                                                                                           |
| **New Prisma `FeatureUsage` table** | Requires a model in `prisma/schema.prisma` **and** a mirrored `ensureDatabaseSchema` DDL block (Rule W, both drivers) plus one write per command — for a number nobody audits. Sample DDL is parked in §10.3 for the day a restart-safe budget justifies it. |
| **Per-handler bespoke cooldowns**   | This is the existing fragmentation (Section 2). It is what the design replaces.                                                                                                                                                                              |
| **Reuse `AgentRateLimiter` class**  | Hard-coded to 3 requests / 60 s for the LLM path. Reuse the _pattern_, not the class.                                                                                                                                                                        |
| **Global anti-spam only**           | `antiSpamGuard` caps message rate, not per-feature cost. Ten cheap commands and ten sticker commands look identical to it.                                                                                                                                   |

---

## 4. Architecture

### 4.1 Declaration

Add an optional `limit` field to `ToolDefinition` (`src/tools/types.ts`):

```typescript
export interface ToolDefinition {
    name: string;
    // ... existing fields ...

    /**
     * Key into TIER_LIMITS[*].featureLimits. Lets the subscriber's plan (Pulse / Nova /
     * Zenith) decide how many uses are allowed; see §5.
     */
    limitKey?: 'sticker' | 'download' | 'ai' | 'stt' | 'webSearch';

    /**
     * Fallback per-user usage limit enforced centrally by ToolsHandler.execute() when the
     * user's plan does not configure `limitKey`. `max` invocations per `windowMs` per JID.
     */
    limit?: { max: number; windowMs: number };
}
```

### 4.2 Enforcement

A new helper, `src/utils/featureLimiter.ts`, holds the sliding-window counter **and** the cached
plan lookup from §5.3:

```typescript
const hits = new Map<string, number[]>(); // key: `${toolName}:${userJid}`

export function tryConsume(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const window = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (window.length >= max) {
        hits.set(key, window);
        return false;
    }
    window.push(now);
    hits.set(key, window);
    return true;
}
```

The check sits in `ToolsHandler.execute()` (`src/tools/handler.ts`), **before** the tutorial
interception and before `tool.execute()`. The ceiling is resolved from the caller's plan first
(owner bypass, tier lookup, tool fallback — the order in §5.2):

```typescript
const lim = await featureLimiter.effectiveLimit(tool, ctx.jid, isOwnerId(ctx.jid));
if (lim && !featureLimiter.tryConsume(`${tool.definition.name}:${ctx.jid}`, lim.max, lim.windowMs)) {
    const minutes = Math.ceil(lim.windowMs / 60_000);
    return ctx.t('limits.cooldown', { minutes });
}
```

`effectiveLimit()` returns `null` for the owner, for tools that declare no limit, and for tiers
with no configured value (falling back to the tool's own `limit`). It reads the tier through the
60-second cached accessor described in §5.3 — never a full `getUserQuota()` round trip.

The map is pruned with the same oldest-eviction discipline used by
`src/utils/security/antiSpamGuard.ts` (bounded size, oldest key evicted first) so a key-spray
cannot grow memory without bound.

### 4.3 Flow

```
message.ts  →  anti-spam guard  →  tool gate (owner / whitelist)
                                      │
                                      ▼
                        ToolsHandler.execute()          ← single funnel
                                      │
                          ┌───────────┴────────────┐
                          ▼                        ▼
               limit applies? (owner → no,    no limit → run
               tool silent → no, §5.2)
                          │
              resolve ceiling from plan (§5.4)
                          │
                tryConsume(key) ── false → localized "please wait" reply (no side effects)
                          │
                        true → tool.execute()
```

Consumption happens **only on the success path check**, before execution. A tool that fails
internally still consumed its budget — that is intentional, because a failed ffmpeg spawn costs
as much as a successful one.

---

## 5. Configuration — limits follow the user's plan

Cosmos already sells plans on the website and already resolves them inside the bot process.
Feature limits are **one more key in the existing tier table**, not a new subsystem: the tool
declares the **shape** (which feature, which window), the subscriber's plan supplies the
**number**.

### 5.1 The plans that already exist

| Tier (code)  | Display name            | Price / month | Existing perks (today)                                           |
| :----------- | :---------------------- | :------------ | :--------------------------------------------------------------- |
| `FREE`       | **Pulse**               | Rp0           | 2 sub-bots, 5 whitelisted groups, locked `(.)` prefix, 1.0x eco  |
| `SUBSIDIZED` | **Nova** (Most Popular) | Rp10.000      | 5 sub-bots, 10 groups, custom prefix, medium support, 1.05x eco  |
| `PARTNER`    | **Zenith**              | Rp32.000      | 12 sub-bots, 25 groups, custom prefix, direct support, 1.15x eco |

Authoritative sources — every one of these must stay in agreement:

| What                     | Location                                                                         |
| :----------------------- | :------------------------------------------------------------------------------- |
| Tier enum                | `prisma/schema.prisma:36-40` (`FREE \| SUBSIDIZED \| PARTNER`)                   |
| Tier defaults            | `src/services/quotaService.ts:24-31` (`TIER_LIMITS`)                             |
| Prices                   | `src/services/subscriptionService.ts:6` (`TIER_PRICES`)                          |
| Per-subscriber overrides | `prisma/schema.prisma:56-70` (`Subscription.maxSubBots/maxGroups/customPrefix`)  |
| Marketing copy (EN/ID)   | `.worktrees/website/lib/dictionary.ts:549-589`                                   |
| Pricing comparison table | `.worktrees/website/app/pricing/page.tsx:22-68`                                  |
| Bot-facing plan labels   | `src/locales/{en,id}/tools.json` → `tools.myplan.tier_*` (Pulse / Nova / Zenith) |

Plans are activated manually — sales chat from the pricing button, then `POST /api/v1/admin/subscriptions/activate`
or the owner-only `.sub add <phone> <tier> <days>` (`src/tools/subscription.ts`). There is no
payment gateway, so `PaymentTransaction` only records the manual transfer.

### 5.2 Resolution order

```typescript
function effectiveLimit(tool: ToolModule, userJid: string, isOwner: boolean) {
    if (isOwner) return null; // 1. owner bypass (quotaService.ts:50-62)
    if (!tool.definition.limit) return null; // 2. tool declares no limit
    const tier = getTierCached(userJid); // 3. FREE when no active row
    return TIER_LIMITS[tier].featureLimits?.[tool.definition.limitKey] ?? tool.definition.limit; // 4. tier value, else tool default
}
```

Notes on each step:

1. **Owner bypass** — identical to `QuotaService.getUserQuota()`, which reports `PARTNER` with
   `Infinity` maxima for the owner. The limit system must not become the one quota the owner
   cannot exceed.
2. **No declaration, no limit** — tools opt in.
3. **Expiry degrades automatically.** `getUserQuota` already falls back to `FREE` when the row is
   missing, `status !== 'ACTIVE'`, or `expiresAt` has passed (`src/services/quotaService.ts:64-67`),
   and the daily 00:00 UTC reconciliation marks stale rows `EXPIRED`
   (`src/services/subscriptionChecker.ts:12-60`). An expired Zenith subscriber is therefore
   throttled as a Pulse user on the very next command — no extra code.
4. **Tier table wins over the tool default.** The tool's own `limit` is the fallback for tiers
   that do not configure this feature, so adding a feature never requires touching every tier.

### 5.3 Reading the plan must stay cheap

`getUserQuota()` performs one `findUnique` plus two `count()` queries per call — too heavy to run
before **every** command. The limiter therefore reads the tier through a small cached accessor
inside `featureLimiter.ts`:

- **60-second TTL** per JID, one row read (`prisma.subscription.findUnique`).
- **Invalidated eagerly** by the existing IPC activation hook `/internal/subscriptions/activated`
  (`src/services/ipcServer.ts:138-153`), so a user who upgrades mid-session gets their higher
  limits immediately instead of waiting out the TTL.

A 60-second staleness window is harmless here: the counter is already in-memory and already
reset on restart, and the only consequence of staleness is that a brand-new subscriber keeps the
old ceiling for at most a minute.

### 5.4 Proposed limit matrix

Suggested starting values — all numbers live in `TIER_LIMITS`, none in the tools:

| Feature class                | Window     | Pulse (`FREE`) | Nova (`SUBSIDIZED`) | Zenith (`PARTNER`) | Rationale                                   |
| :--------------------------- | :--------- | -------------: | ------------------: | -----------------: | :------------------------------------------ |
| CPU-bound (sticker, brat)    | 10 minutes |              5 |                  15 |                 40 | ffmpeg/sharp bursts are the real bottleneck |
| Download (yt, tt, pinterest) | 10 minutes |              3 |                  10 |                 25 | process spawn + remote fetch                |
| AI / LLM (`sara`, agent)     | 5 minutes  |             10 |                  40 |              `∞`\* | token spend accrues fast; short window      |
| Speech-to-text (Whisper)     | 10 minutes |              5 |                  20 |                 50 | audio upload + transcription cost           |
| Web search (Tavily)          | 10 minutes |             10 |                  50 |                150 | cheap per call, quota-bound                 |

\* The bot does not meter Groq spend, so `∞` means "no bot-side cap", not "no cost" — the
existing `AgentRateLimiter` (3 requests / 60 s plus a 5 s consecutive cooldown,
`src/services/agentEngine/rateLimiter.ts`) still bounds LLM concurrency for **every** tier and
is not replaced by this system.

Windows follow cost shape, not plan: CPU and download features get 10-minute windows because
ffmpeg/sharp bursts and process spawns are the bottleneck; AI and STT get 1–5 minutes because
token spend accrues fast; cheap reads get 10 minutes since they only guard an API quota.

### 5.5 Declaration shape

```typescript
// src/services/quotaService.ts
export const TIER_LIMITS: Record<SubscriptionTierName, TierLimits> = {
    FREE: {
        maxGroups: 5,
        maxSubBots: 2,
        customPrefix: false,
        economyMultiplier: 1.0,
        featureLimits: {
            sticker: { max: 5, windowMs: 600_000 },
            download: { max: 3, windowMs: 600_000 },
            ai: { max: 10, windowMs: 300_000 },
            stt: { max: 5, windowMs: 600_000 },
            webSearch: { max: 10, windowMs: 600_000 }
        }
    },
    SUBSIDIZED: {/* ... */},
    PARTNER: {/* ... */}
};
```

```typescript
// src/tools/sticker_maker.ts
export const definition: ToolDefinition = {
    name: 'sticker maker',
    // ... existing fields ...
    limitKey: 'sticker', // references a key in TIER_LIMITS[*].featureLimits
    limit: { max: 5, windowMs: 600_000 } // fallback when the tier does not configure limitKey
};
```

The API Gateway copy of `TIER_LIMITS` (`.worktrees/api/src/services/quotaService.ts:24-31`) does
**not** need `featureLimits`: no tool executes over there, so it never enforces one. Leave a
comment in both files recording that asymmetry so the next schema edit does not "fix" the drift.

### 5.6 Where users must see their limits

A plan perk nobody can observe is not a perk. Feature limits belong in the three surfaces that
already display plan entitlements:

1. **`.my quota`** (`src/tools/quota.ts`, aliases include `.limits`) — it already renders
   `renderUsageBar()` for groups and sub-bots; add one bar per limited feature showing
   `used / plan max` in the current window.
2. **`.my plan`** (`src/tools/myplan.ts`) — list the tier's feature ceilings next to the existing
   sub-bot and group perks.
3. **The pricing page** (`.worktrees/website/app/pricing/page.tsx` comparison table plus
   `dictionary.ts` in EN and ID) — the row that justifies Nova and Zenith costs.

If a number changes, it changes in **all** places. This triplication already exists for
`maxGroups` / `maxSubBots` (bot, API, website) and is a known maintenance cost — the alternative,
a package shared across worktrees, is a build-level refactor that is out of scope here.

---

## 6. Coverage

The funnel covers every command dispatched through `toolsHandler.execute(...)`. Two paths
**bypass** the funnel today and must be handled explicitly if their feature is limited:

| Bypass path                    | Location                                               | Handling                                                                                      |
| :----------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| Auto-sticker direct invocation | `src/handlers/message.ts` (~line 1033)                 | Call `featureLimiter.tryConsume` before dispatch, or route it through `toolsHandler.execute`. |
| Non-command AI responder       | `src/handlers/message.ts` (`handleOfflineAiResponder`) | Covered by the existing `AgentRateLimiter`; no change needed.                                 |

Future tools — including a background-removal tool, which **does not yet exist** in this
codebase — inherit the system automatically by declaring `limitKey` (plus a `limit` fallback).

---

## 7. User-facing strings

Limit replies are output strings and therefore **Formal English** (Rule H) via i18n (Rule O).
Register the key symmetrically in `src/locales/en/` and `src/locales/id/`:

```json
{
    "limits": {
        "cooldown": "You have reached the temporary limit for this command. Please try again in {{minutes}} minute(s).",
        "cooldown_free": "You have reached the temporary limit for this command on the Pulse (Free) plan. Please try again in {{minutes}} minute(s), or use .my plan to compare the Nova and Zenith allowances."
    }
}
```

The reply must state the remaining wait time; a bare "limit exceeded" generates retry storms,
which is the opposite of the goal. When the caller is on `FREE`, use `cooldown_free` — a plan
limit is the natural place to surface the upgrade path, and the plan comparison is one command
away. Both keys exist in `en` and `id`; resolve with `i18n.exists()` so a missing key falls back
to `limits.cooldown` instead of printing the key itself.

---

## 8. Adoption guide

To add a limit to an existing or new tool:

1. Open the tool file in `src/tools/`.
2. Add `limitKey: '<feature>'` and a fallback `limit: { max: N, windowMs: MS }` to its
   `definition` export.
3. Configure `featureLimits['<feature>']` for **all three tiers** in `TIER_LIMITS`
   (`src/services/quotaService.ts`). Pulse gets the strict ceiling; Zenith gets the generous one.
   Leave `.worktrees/api/src/services/quotaService.ts` untouched and note why (§5.5).
4. Add the `limits.cooldown` / `limits.cooldown_free` keys to `src/locales/en/` and
   `src/locales/id/`.
5. Surface the numbers where plans are already shown: a `renderUsageBar()` row in
   `.my quota` (`src/tools/quota.ts`), and a comparison-table row on `/pricing` plus
   `dictionary.ts` if the feature is a selling point (§5.6).
6. Verify: `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm run version:bump patch`,
   `pnpm run version:check`, then commit.

No handler logic changes. The funnel and the tier table do the rest.

---

## 9. Non-goals

Deliberately **not** in scope for the first iteration:

- **Persistent counters across restarts.** Add a `FeatureUsage` table only if a quota must
  survive restarts (for example a daily budget tied to real Groq spend) — sample DDL is kept
  ready in §10.3, and `FeatureLimit` in §10.2 for admin-editable ceilings.
- **Dollar/Rp pricing of commands.** Economy integration stays with `User.balance`.
- **Global concurrency caps per feature** (e.g. "at most 3 ffmpeg jobs at once"). The existing
  `src/utils/stickerQueue.ts` single-flight queue already serializes sticker encoding; a global
  semaphore is only needed if throughput ever becomes the measured bottleneck.
- **Per-group limits.** Keyed per user JID for now; the key format
  (`${toolName}:${userJid}`) leaves room to append a group component later without a migration.
- **Per-subscriber feature overrides.** `Subscription` already overrides `maxGroups`,
  `maxSubBots`, and `customPrefix` per row (`prisma/schema.prisma:62-64`), but has **no**
  per-feature columns. Adding them would cost a schema column, a mirrored DDL block in both
  drivers (Rule W), an API schema/copy update, and an admin surface — for a case that has not
  occurred yet. Tier-level numbers first; a row override only when a specific partner agreement
  demands one.
- **A shared limit package across worktrees.** Bot, API, and website each hold a copy of the
  tier table today (§5.6). Unifying them is a build-level refactor, not a limiter feature.

---

## 10. Sample database schema (reference for implementers)

The limiter as designed **reads one existing table and writes none** — that is deliberate
(§3.1). The two optional tables below cover the two extension points a team may want later; each
is given as a Prisma model plus the `better-sqlite3` DDL block that goes into
`ensureDatabaseSchema()`, so it can be pasted in as-is.

### 10.1 Read-only today (no migration required)

```
User (id = JID)
  │ 1:1
  ▼
Subscription ── tier ──► TIER_LIMITS (code, src/services/quotaService.ts:24-31)
  │                       └─ the numbers in §5.4 live here, not in the database
  │ 1:N
  ▼
PaymentTransaction (manual WhatsApp purchase record)
```

Existing DDL, quoted from `src/db.ts:98-111` — this is the whole schema phase 1 needs:

```sql
CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "maxSubBots" INTEGER NOT NULL DEFAULT 2,
    "maxGroups" INTEGER NOT NULL DEFAULT 5,
    "customPrefix" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_userId_key" ON "Subscription"("userId");
```

The limiter touches it with a single row read
(`prisma.subscription.findUnique({ where: { userId: jid } })`), cached for 60 s (§5.3).

### 10.2 Phase 2 (optional) — `FeatureLimit`: ceilings editable without a redeploy

Needed only when the team wants to tune a plan's allowance from the website or an admin command
instead of editing `TIER_LIMITS` and shipping a build. Resolution chain becomes:
**`FeatureLimit` row → `TIER_LIMITS` → tool `limit` default.**

```prisma
// prisma/schema.prisma
model FeatureLimit {
  id            String           @id @default(cuid())
  tier          SubscriptionTier
  featureKey    String // 'sticker' | 'download' | 'ai' | 'stt' | 'webSearch'
  maxUsage      Int // 0 = unlimited (Zenith AI in §5.4)
  windowSeconds Int
  enabled       Boolean          @default(true)
  updatedAt     DateTime         @updatedAt

  @@unique([tier, featureKey])
}
```

```sql
-- ensureDatabaseSchema(): new table, so every column exists before the index runs (Rule W phase 1 + 3)
CREATE TABLE IF NOT EXISTS "FeatureLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tier" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "maxUsage" INTEGER NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureLimit_tier_featureKey_key" ON "FeatureLimit"("tier","featureKey");

-- Seed: idempotent copy of the §5.4 matrix
INSERT OR IGNORE INTO "FeatureLimit" ("id", "tier", "featureKey", "maxUsage", "windowSeconds") VALUES
    ('fl_free_sticker',     'FREE',       'sticker',   5,   600),
    ('fl_free_download',    'FREE',       'download',  3,   600),
    ('fl_free_ai',          'FREE',       'ai',        10,  300),
    ('fl_free_stt',         'FREE',       'stt',       5,   600),
    ('fl_free_websearch',   'FREE',       'webSearch', 10,  600),
    ('fl_sub_sticker',      'SUBSIDIZED', 'sticker',   15,  600),
    ('fl_sub_download',     'SUBSIDIZED', 'download',  10,  600),
    ('fl_sub_ai',           'SUBSIDIZED', 'ai',        40,  300),
    ('fl_sub_stt',          'SUBSIDIZED', 'stt',       20,  600),
    ('fl_sub_websearch',    'SUBSIDIZED', 'webSearch', 50,  600),
    ('fl_partner_sticker',  'PARTNER',    'sticker',   40,  600),
    ('fl_partner_download', 'PARTNER',    'download',  25,  600),
    ('fl_partner_ai',       'PARTNER',    'ai',        0,   300),
    ('fl_partner_stt',      'PARTNER',    'stt',       50,  600),
    ('fl_partner_websearch','PARTNER',    'webSearch', 150, 600);
```

There is **no foreign key** on `tier`: `SubscriptionTier` is a Prisma enum, not a table. Read the
table through the same 60-second cache as the tier lookup (§5.3) so the extra query does not run
per command.

### 10.3 Phase 3 (optional) — `FeatureUsage`: counters that survive a restart

Needed only for budgets that must not reset when the process does (a daily allowance tied to real
Groq/Tavily spend). Phase 1 stays in-memory; this table replaces the `Map`, it does not extend it.

```prisma
// prisma/schema.prisma
model FeatureUsage {
  id          String   @id @default(cuid())
  userJid     String // JID as used by ToolContext.jid
  featureKey  String
  windowStart DateTime // start of the current fixed window
  used        Int      @default(0)
  updatedAt   DateTime @updatedAt

  @@unique([userJid, featureKey, windowStart])
  @@index([windowStart])
}
```

```sql
CREATE TABLE IF NOT EXISTS "FeatureUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userJid" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureUsage_userJid_featureKey_windowStart_key" ON "FeatureUsage"("userJid","featureKey","windowStart");
CREATE INDEX IF NOT EXISTS "FeatureUsage_windowStart_idx" ON "FeatureUsage"("windowStart");
```

Semantics:

- **Fixed window, not sliding.** The window start is computed as
  `Math.floor(now / windowMs) * windowMs`, then one atomic upsert:
  `INSERT ... ON CONFLICT("userJid","featureKey","windowStart") DO UPDATE SET "used" = "used" + 1`.
  A sliding window in SQL would need one row per hit — unacceptable write volume for a
  hot-path limiter.
- **Prune, do not leak.** Rows accumulate one per (user, feature, window). Delete everything
  older than 24 h from the existing daily reconciliation job
  (`src/services/subscriptionChecker.ts`, scheduled in `src/index.ts:51-60`) — **never**
  `setTimeout` in memory (Rule J).
- **No FK on `userJid`.** A JID may hit a tool before its `User` row exists; pruning clears any
  stray rows.

### 10.4 Maintenance checklist

| Concern     | Requirement                                                                                                                                                                                                                                                 |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual driver | Any table added here goes into `prisma/schema.prisma` **and** the DDL block in `src/db.ts` (`ensureDatabaseSchema`), in that order of precedence: `CREATE TABLE` → `ensureColumnExists` for later columns → `CREATE INDEX` in its own `try/catch` (Rule W). |
| API copy    | `.worktrees/api/**` does **not** get these tables: no tool executes there, so it never reads or writes them (same asymmetry as §5.5). Leave a comment recording it.                                                                                         |
| Index names | Follow Prisma conventions already used in `src/db.ts`: `<Table>_<cols>_key` for unique, `<Table>_<cols>_idx` for regular.                                                                                                                                   |
| Backfill    | Seeds use `INSERT OR IGNORE` against the unique index, so re-running `ensureDatabaseSchema` on an existing database is safe.                                                                                                                                |
| Read path   | Both optional tables are read through the 60-second cache in §5.3, never per command.                                                                                                                                                                       |

---

## 11. Related rules

- **Rule H** — Formal English for all output strings.
- **Rule O** — i18n integration and `i18n.exists()` safe key detection.
- **Rule W** — If the persistent variant is ever adopted, mirror DDL in both `src/db.ts` and
  `.worktrees/api/src/db.ts`.
- **Rule S.1** — This document and its implementation changes require a `patch` version bump.
- **Rule AF** — Command names referenced here follow spaced, multi-token naming.
