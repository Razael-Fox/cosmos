# Cosmos Feature Limit System — Design Specification

**Status:** Proposed (design only — not yet implemented)

A per-feature usage limit system that protects server resources (ffmpeg, sharp, yt-dlp, Groq
LLM calls) by capping how often each command may be invoked, per user, within a time window.

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
> execution funnel `ToolsHandler.execute()`. In-memory, not database-backed.**

Three properties make this the right shape:

1. **One choke point already exists.** Every command — current and future — passes through
   `ToolsHandler.execute()` in `src/tools/handler.ts`. Declaring the limit on the tool
   definition and checking it there covers every tool with one edit, instead of one edit per
   handler.
2. **In-memory is correct for the goal.** The objective is protecting the CPU and the Groq
   quota, not billing users. A counter that resets on restart is acceptable: a restart is rare,
   and a lost counter merely grants one fresh budget.
3. **The limit is declarative.** A tool author states a policy
   (`limit: { max: 5, windowMs: 600_000 }`) and never writes timing logic.

### 3.1 Alternatives considered and rejected

| Alternative                         | Why rejected                                                                                                                                                                   |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Charge `User.balance` (economy)** | Prices usage instead of capping concurrency, distorts game balance, and forces `$transaction` + confirmation + i18n work under Rule P. Wrong tool.                             |
| **New Prisma `FeatureUsage` table** | Requires a model in `prisma/schema.prisma` **and** a mirrored `ensureDatabaseSchema` DDL block (Rule W, both drivers) plus one write per command — for a number nobody audits. |
| **Per-handler bespoke cooldowns**   | This is the existing fragmentation (Section 2). It is what the design replaces.                                                                                                |
| **Reuse `AgentRateLimiter` class**  | Hard-coded to 3 requests / 60 s for the LLM path. Reuse the _pattern_, not the class.                                                                                          |
| **Global anti-spam only**           | `antiSpamGuard` caps message rate, not per-feature cost. Ten cheap commands and ten sticker commands look identical to it.                                                     |

---

## 4. Architecture

### 4.1 Declaration

Add an optional `limit` field to `ToolDefinition` (`src/tools/types.ts`):

```typescript
export interface ToolDefinition {
    name: string;
    // ... existing fields ...

    /**
     * Optional per-user usage limit enforced centrally by ToolsHandler.execute().
     * `max` invocations are permitted per `windowMs` per user JID.
     */
    limit?: { max: number; windowMs: number };
}
```

### 4.2 Enforcement

A new helper, `src/utils/featureLimiter.ts`, holds a sliding-window counter:

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
interception and before `tool.execute()`:

```typescript
const lim = tool.definition.limit;
if (lim && !featureLimiter.tryConsume(`${tool.definition.name}:${ctx.jid}`, lim.max, lim.windowMs)) {
    const seconds = Math.ceil(lim.windowMs / 60_000);
    return ctx.t('limits.cooldown', { minutes: seconds });
}
```

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
                          ┌───────────┴───────────┐
                          ▼                       ▼
                   limit declared?          no limit → run
                          │
                tryConsume(key) ── false → localized "please wait" reply (no side effects)
                          │
                        true → tool.execute()
```

Consumption happens **only on the success path check**, before execution. A tool that fails
internally still consumed its budget — that is intentional, because a failed ffmpeg spawn costs
as much as a successful one.

---

## 5. Configuration

Limits are **per tier**, not hard-coded per tool, so paid tiers are not punished. The tier table
already exists in `quotaService.ts` (`TIER_LIMITS`), which is the natural home:

```typescript
// src/services/quotaService.ts
export const TIER_LIMITS = {
    free: { /* existing fields... */ featureLimits: { sticker: 5, download: 3, ai: 10, stt: 5 } },
    premium: { /* existing fields... */ featureLimits: { sticker: 20, download: 10, ai: 50, stt: 20 } }
    // ...
};
```

The tool declares **shape** (`max`, `windowMs`); the tier table supplies the **number**. When no
tier value is configured, the tool's own `limit` is used as the default.

Suggested windows:

| Feature class              | Window     | Rationale                                    |
| :------------------------- | :--------- | :------------------------------------------- |
| CPU-bound (sticker, brat)  | 10 minutes | ffmpeg/sharp bursts are the real bottleneck  |
| Network download (yt, tt)  | 10 minutes | process spawn + remote fetch                 |
| AI / LLM / STT             | 1 minute   | token spend accrues fast; keep windows short |
| Cheap reads (search, etc.) | 1 minute   | generous, only guards API quota              |

---

## 6. Coverage

The funnel covers every command dispatched through `toolsHandler.execute(...)`. Two paths
**bypass** the funnel today and must be handled explicitly if their feature is limited:

| Bypass path                    | Location                                               | Handling                                                                                      |
| :----------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| Auto-sticker direct invocation | `src/handlers/message.ts` (~line 1033)                 | Call `featureLimiter.tryConsume` before dispatch, or route it through `toolsHandler.execute`. |
| Non-command AI responder       | `src/handlers/message.ts` (`handleOfflineAiResponder`) | Covered by the existing `AgentRateLimiter`; no change needed.                                 |

Future tools — including a background-removal tool, which **does not yet exist** in this
codebase — inherit the system automatically by declaring `limit`.

---

## 7. User-facing strings

Limit replies are output strings and therefore **Formal English** (Rule H) via i18n (Rule O).
Register the key symmetrically in `src/locales/en/` and `src/locales/id/`:

```json
{
    "limits": {
        "cooldown": "You have reached the temporary limit for this command. Please try again in {{minutes}} minute(s)."
    }
}
```

The reply must state the remaining wait time; a bare "limit exceeded" generates retry storms,
which is the opposite of the goal.

---

## 8. Adoption guide

To add a limit to an existing or new tool:

1. Open the tool file in `src/tools/`.
2. Add `limit: { max: N, windowMs: MS }` to its `definition` export.
3. Add the tier override to `TIER_LIMITS` in `src/services/quotaService.ts` (optional).
4. Add the `limits.cooldown` key to `src/locales/en/` and `src/locales/id/`.
5. Verify: `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm run version:bump patch`,
   `pnpm run version:check`, then commit.

No handler logic changes. The funnel does the rest.

---

## 9. Non-goals

Deliberately **not** in scope for the first iteration:

- **Persistent counters across restarts.** Add a `FeatureUsage` table only if a quota must
  survive restarts (for example a daily budget tied to real Groq spend).
- **Dollar/Rp pricing of commands.** Economy integration stays with `User.balance`.
- **Global concurrency caps per feature** (e.g. "at most 3 ffmpeg jobs at once"). The existing
  `src/utils/stickerQueue.ts` single-flight queue already serializes sticker encoding; a global
  semaphore is only needed if throughput ever becomes the measured bottleneck.
- **Per-group limits.** Keyed per user JID for now; the key format
  (`${toolName}:${userJid}`) leaves room to append a group component later without a migration.

---

## 10. Related rules

- **Rule H** — Formal English for all output strings.
- **Rule O** — i18n integration and `i18n.exists()` safe key detection.
- **Rule W** — If the persistent variant is ever adopted, mirror DDL in both `src/db.ts` and
  `.worktrees/api/src/db.ts`.
- **Rule S.1** — This document and its implementation changes require a `patch` version bump.
- **Rule AF** — Command names referenced here follow spaced, multi-token naming.
