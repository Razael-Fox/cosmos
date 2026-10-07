# Cosmos MCP Server — Operator Guide

Implements [GitHub issue #49](https://github.com/Razael-Fox/cosmos/issues/49): a first-party
Model Context Protocol server that gives AI coding agents (OpenCode, Claude Code, Pi, Google
Antigravity) typed, guarded, audited access to the Cosmos database, feature catalogue, and
live bot actions.

The agent-facing rules live in [`AGENTS.md` §AH](../AGENTS.md) and
[`.agents/skills/cosmos-mcp/SKILL.md`](../.agents/skills/cosmos-mcp/SKILL.md). This document
covers deployment, configuration, and operations.

---

## 1. Why it exists

Before this server, every Cosmos-touching agent request followed the same failure pattern:

1. The agent reached for `npm`/`npx`, mutating the PNPM lockfile and desynchronising
   `node_modules`.
2. In a sibling workspace (`.worktrees/api`, `.worktrees/website`, a fresh clone on another
   machine) there was no `node_modules`, no Prisma client, and no `dist/`, so the agent fell
   back to shelling out to arbitrary one-off commands.
3. Nothing told the agent what Cosmos _is_ — that the database is a 37-model Prisma SQLite
   schema mirrored by `better-sqlite3` DDL in two drivers, that financial mutations must run
   inside `prisma.$transaction`, that schema changes follow a 3-phase DDL order.
4. Live bot actions, such as _"broadcast to all groups with a 5-second delay per group"_,
   were reachable only from inside the bot process over a Unix socket, so the agent wrote a
   throwaway script that bypassed every guardrail in `AGENTS.md`.

The Cosmos MCP server replaces all four with a first-class, self-describing tool surface.

---

## 2. Architecture

```
+--------------------------------------------------------------------------+
|  AI Coding Agent (OpenCode / Claude Code / Pi / Antigravity)              |
|  - stdio transport  (local, same machine)                                |
|  - Streamable HTTP  (remote, over an SSH tunnel)                         |
+-------------------------------+-----------------------------------------+
                                | x-internal-secret / Bearer  (single owner key)
                                v
+--------------------------------------------------------------------------+
|  cosmos-mcp  (src/mcp/, PM2 app in the single container)                 |
|  - auth.ts       single-owner key, constant-time compare, fail closed    |
|  - server.ts     per-identity McpServer + cosmos_guidance contract        |
|  - sql/          read-only SQLite + guardrails                           |
|  - schema/       prisma catalogue, Rule W checks, mutation planner      |
|  - tools/        cosmos_db_* / cosmos_* / cosmos_bot_*                   |
+-------------------------------+-----------------------------------------+
                                | sendIpcCommand over the Unix socket
                                v
+--------------------------------------------------------------------------+
|  cosmos-bot engine (src/services/ipcServer.ts, Rule Y)                   |
|  /internal/broadcast, /internal/messages/send, /internal/bot/status, ... |
+-------------------------------+-----------------------------------------+
                                v
+--------------------------------------------------------------------------+
|  SQLite (Prisma)  +  broadcastService.ts persistent fan-out queue        |
+--------------------------------------------------------------------------+
```

**Where the code lives.** The server ships in the **bot engine** (`src/mcp/`) rather than in
`.worktrees/api/`, because the repo tracks `.worktrees/` as a separate git worktree on its own
branch: code placed there could not be reviewed or merged through a pull request on `main`,
which would defeat the purpose. The bot engine already owns the Prisma client, the tool
registry, the backup pipeline, the DDL bootstrap, and the IPC client, so the server is a thin
layer over existing surfaces rather than a parallel implementation.

**Workspace independence.** Because the server runs from the deployed container, an agent in a
fresh clone, in a sibling worktree, or on a different machine has identical capabilities —
without `node_modules`, without a generated Prisma client, and without a compiled `dist/`.

---

## 3. Access model: one key, one owner

> The entire MCP surface is gated behind **exactly one** API key, held personally by the
> repository owner.

| Property           | Behaviour                                                                                                                                                     |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key count          | Exactly one. There is no second key path.                                                                                                                     |
| Key issuance       | Provisioned out-of-band by the owner. No self-service signup, no "bring your own key".                                                                        |
| Rotation           | **Owner-only.** Regenerate in the secret manager, redeploy, reconfigure clients.                                                                              |
| Automated rotation | None, deliberately.                                                                                                                                           |
| Recovery path      | None. No backdoor, no escrow copy, no "contact support" route.                                                                                                |
| Comparison         | Constant time via the existing `timingSafeStringCompare` helper.                                                                                              |
| Leakage            | The key never appears in a tool result, an error, or a Pterodactyl-visible log line.                                                                          |
| Audit              | `ActivityLog` records the acting **holder** plus the tool name and before/after diff, so the trail survives rotation.                                         |
| Missing key        | The server **refuses to start**; HTTP requests are refused with `401 UNAUTHORIZED_MCP`. There is no anonymous, default, development, or loopback-bypass mode. |

**Why a collaborator without the key is refused is intentional, not an oversight.** The tools
expose direct write access to the bank, loan, inventory, and economy ledgers plus live
broadcast capability, so access is owner-scoped by design rather than by role. Because there
is no second credential and no automated rotation, any exposure is owner-side to resolve; the
design accepts that in exchange for guaranteeing that no collaborator, third-party agent, or
leaked configuration can reach the ledgers or the broadcast capability.

All four clients (OpenCode, Claude Code, Pi, Antigravity) reference the **same** key, so
rotation is a single owner action that updates every client at once — and revocation is
immediate and total.

---

## 4. Transports

### stdio (primary, local)

```bash
COSMOS_MCP_TOKEN=... pnpm mcp:start              # tsx, from a checkout
node dist/mcp/index.js                           # compiled
```

Because stdio has no per-request headers, its authorisation model is _"the process was started
with the owner's secret in its environment"_. Transport hygiene plus process isolation is the
control. Never expose stdio to an untrusted parent process.

### Streamable HTTP (remote / containerised)

```bash
COSMOS_MCP_TOKEN=... pnpm mcp:http
# -> [MCP] Streamable HTTP transport listening on http://127.0.0.1:4100/mcp (loopback only).
```

- Bound to **loopback only**. A non-loopback `COSMOS_MCP_HTTP_BIND` makes the server refuse to
  start (Rule V).
- **Never proxied by the public Nginx listener** — `docker/nginx.conf` returns `404` for
  `/mcp` explicitly, so the boundary is visible and enforced.
- Every request is authenticated with `x-internal-secret` (or `Authorization: Bearer`), even
  from loopback. Loopback binding is hygiene, not an authorisation substitute.
- Reach it from another machine with an SSH tunnel:
  `ssh -L 4100:127.0.0.1:4100 <host>`.

---

## 5. Configuration

All configuration is read from the environment. Nothing sensitive is ever baked into the
Docker image, committed, or returned by a tool.

| Variable                              | Default      | Purpose                                                                            |
| :------------------------------------ | :----------- | :--------------------------------------------------------------------------------- |
| `COSMOS_MCP_TOKEN`                    | _(empty)_    | **The single owner API key.** Empty ⇒ the server fails to start.                   |
| `COSMOS_MCP_HTTP_ENABLED`             | `true`       | Enables the Streamable HTTP transport.                                             |
| `COSMOS_MCP_HTTP_BIND`                | `127.0.0.1`  | Loopback-only bind address (Rule V).                                               |
| `COSMOS_MCP_HTTP_PORT`                | `4100`       | HTTP port; `0` disables HTTP.                                                      |
| `COSMOS_MCP_READ_ONLY`                | `false`      | `true` compiles the entire mutating toolset out.                                   |
| `COSMOS_MCP_AUDIT_USER_JID`           | _(empty)_    | `ActivityLog.userId` for audit rows; falls back to the first `OWNER_PHONE_NUMBER`. |
| `COSMOS_MCP_DEFAULT_QUERY_LIMIT`      | `200`        | Default `LIMIT` for `cosmos_db_query`.                                             |
| `COSMOS_MCP_MAX_QUERY_LIMIT`          | `1000`       | Hard ceiling on any client-supplied `LIMIT`.                                       |
| `COSMOS_MCP_MAX_BULK_DELETE_ROWS`     | `50`         | Ceiling for `delete` fan-out.                                                      |
| `COSMOS_MCP_MAX_BROADCAST_TARGETS`    | `5000`       | Ceiling on resolved broadcast targets.                                             |
| `COSMOS_MCP_MIN_BROADCAST_DELAY_MS`   | `1000`       | Minimum inter-group broadcast delay.                                               |
| `COSMOS_MCP_MAX_BROADCAST_DELAY_MS`   | `3600000`    | Maximum inter-group broadcast delay.                                               |
| `COSMOS_MCP_MAX_MESSAGE_LENGTH`       | `4096`       | Maximum outbound operator message length.                                          |
| `COSMOS_MCP_MAX_CALLS`                | `600`        | Total calls per identity per window.                                               |
| `COSMOS_MCP_MAX_MUTATIONS`            | `60`         | Mutating calls per identity per window.                                            |
| `COSMOS_MCP_MAX_CONCURRENT_MUTATIONS` | `2`          | Concurrent in-flight mutations.                                                    |
| `COSMOS_MCP_RATE_WINDOW_MS`           | `60000`      | Sliding-window length.                                                             |
| `INTERNAL_IPC_SECRET`                 | _(required)_ | Shared secret used by `sendIpcCommand` to reach the bot engine.                    |

`INTERNAL_IPC_SECRET` must be identical to the value the bot engine uses, otherwise every
`cosmos_bot_*` tool returns `BOT_OFFLINE`.

---

## 6. Tool surface

### `cosmos_db_*` — database access

| Tool                         | Purpose                                                                                                                                                                                            |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cosmos_db_describe`         | Live model/field/type/index/relation catalogue parsed from `prisma/schema.prisma`. The anti-hallucination anchor.                                                                                  |
| `cosmos_db_query`            | Parameterised, **read-only** `SELECT` on a genuinely read-only SQLite handle. Mandatory `LIMIT`, mandatory explicit projection, credential tables denied, mandatory `WHERE` on high-value ledgers. |
| `cosmos_db_count`            | `COUNT(*)` with an optional `WHERE`, same guardrails.                                                                                                                                              |
| `cosmos_db_aggregate`        | `SUM` / `AVG` / `MIN` / `MAX` with optional grouping, same guardrails.                                                                                                                             |
| `cosmos_db_mutation_plan`    | Dry-run planner. Writes nothing.                                                                                                                                                                   |
| `cosmos_db_apply_mutation`   | Executes only against a matching plan fingerprint.                                                                                                                                                 |
| `cosmos_db_backup`           | Runs the existing `src/utils/backup.ts` snapshot pipeline; reports hash and truthful outcome.                                                                                                      |
| `cosmos_db_restore_plan`     | Plan-only restore procedure. Never executes.                                                                                                                                                       |
| `cosmos_db_migration_status` | Reports `schema.prisma` / DDL-driver drift and pending Rule W work.                                                                                                                                |
| `cosmos_db_settings_summary` | Economy multiplier, vault totals, queue depths, user and group counts.                                                                                                                             |

**Credential denylist (`FORBIDDEN_TABLE`).** `WhatsAppAuth`, `WebSession`,
`UserContactBook`, `OtpVerification`.

**Credential column denylist (`FORBIDDEN_COLUMN`).** `passwordHash`, `tokenHash`,
`deviceTokenHash`, `codeHash`, `salt`, `lookupHash`, `encryptedJid`, `value`.

**Mandatory `WHERE` tables (`MISSING_WHERE_CLAUSE`).** `User`, `BankAccount`,
`BankTransaction`, `Loan`, `LoanReminder`, `UserContactBook`, `UserInventory`,
`PropertyTransaction`, `ActivityLog`, `PaymentTransaction`, `IdCard`, `HouseVault`.

#### The planner → executor contract

`cosmos_db_mutation_plan` returns, for one intended mutation:

- `safe` — whether the change may be applied directly.
- `blockers` / `warnings` — e.g. _"does not exist in prisma/schema.prisma"_.
- `requiresDdlMigration` / `mirrorTargets` — Rule W 3-phase DDL work and the exact files
  (`prisma/schema.prisma`, `src/db.ts`, `.worktrees/api/src/db.ts`).
- `requiresAcidTransaction`, `requiresBalanceAfter`, `requiresActivityLog`,
  `requiresTransaction` — whether the change touches a guarded ledger.
- `prismaSnippet`, `transactionSnippet`, `whereSelector` — copy-paste `$transaction`
  boilerplate.
- `checklist` — the per-rule pre-flight list.
- `planFingerprint` — a stable hash of the request.

`cosmos_db_apply_mutation` re-plans internally and refuses with `PLAN_REQUIRED` unless the
supplied fingerprint matches the request byte-for-byte, so a plan can never be reused for a
different mutation. Execution then runs inside `prisma.$transaction`, writes an `ActivityLog`
row, prints a `console.log` line (Rule C), and returns the before/after diff.

### `cosmos_*` — feature and configuration

| Tool                      | Purpose                                                                                                                               |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| `cosmos_feature_list`     | The command registry with canonical **spaced** invocations (`.bank deposit`), `descriptionKey`, aliases, and `en`/`id` display names. |
| `cosmos_feature_describe` | One feature in full, including Rule AF / Rule T violations.                                                                           |
| `cosmos_feature_invoke`   | Validates an invocation — arity, i18n keys, permission gate — **without side effects** by default.                                    |
| `cosmos_settings_get`     | Reads auto-DL, group NSFW, economy, whitelist, and sub-bot settings from the database.                                                |
| `cosmos_settings_set`     | Updates the same, audited, with `confirm: true`.                                                                                      |
| `cosmos_i18n_check`       | `en` vs `id` key parity and interpolation-variable mismatches (Rule O).                                                               |
| `cosmos_schema_check`     | Rule W (3-phase DDL, dual maintenance) and Rule X (worktree isolation) as pass/fail.                                                  |
| `cosmos_guidance`         | The machine-readable agent contract: prohibitions, governance, and the intent → tool map.                                             |

### `cosmos_bot_*` — live bot actions (over the IPC bridge)

| Tool                          | IPC route                                            | Purpose                                                                                        |
| :---------------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `cosmos_bot_status`           | `/internal/bot/status`                               | Online state, uptime, memory, event-loop lag, last `connection.update`.                        |
| `cosmos_bot_health`           | `/internal/health`                                   | IPC reachability probe.                                                                        |
| `cosmos_bot_groups_list`      | `/internal/groups/all`                               | Participating groups with `WhitelistedGroup` fallback; masked JIDs plus `contact_ref` aliases. |
| `cosmos_bot_send_message`     | `/internal/messages/send`                            | Send to one chat. Dry-run by default.                                                          |
| `cosmos_bot_broadcast`        | `/internal/broadcast/preview`, `/internal/broadcast` | **The motivating capability.** Dry-run by default.                                             |
| `cosmos_bot_broadcast_status` | `/internal/broadcast/status`                         | Per-group delivery receipts, or recent jobs.                                                   |
| `cosmos_bot_broadcast_cancel` | `/internal/broadcast/cancel`                         | Release every unsent delivery.                                                                 |
| `cosmos_bot_reconnect`        | `/internal/bot/reconnect`                            | Operator-only, confirmation-gated.                                                             |
| `cosmos_bot_logout`           | `/internal/bot/logout`                               | Operator-only, confirmation-gated, irreversible.                                               |
| `cosmos_bot_subbot_list`      | `/internal/subbots/list`                             | `SubBotInstance` rows plus live socket state.                                                  |
| `cosmos_bot_subbot_status`    | `/internal/subbots/status`                           | Live pairing state, proxied verbatim from the engine.                                          |

---

## 7. Persistent broadcast fan-out

A broadcast with a 5-second delay across many groups spans hours. An in-memory
`setTimeout` loop would lose the remainder on restart (Rule J), so the schedule is persisted.

| Concern     | Persisted as                                                                                                                                                                                        |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The job     | One `StatusNotificationLog` row (`event = 'BROADCAST'`, `status` = `QUEUED` / `RUNNING` / `COMPLETED` / `CANCELLED` / `FAILED`, `channels` = JSON metadata with `jobId`, `delayMs`, `targetCount`). |
| Each target | One `StatusNotificationOutbox` row with `channel = 'broadcast:<jid>'` and `nextAttemptAt = start + index * delayMs`.                                                                                |
| The worker  | `broadcastService.startBroadcastWorker()`, a cron-driven pass invoked from `startIpcServer()`.                                                                                                      |

Reusing the existing status-notification tables means **no schema change**, so the Rule W
dual-maintenance burden is unchanged. To keep the two schedulers from contending,
`statusNotifier/outboxWorker.ts` explicitly skips rows whose `event` is `BROADCAST` or whose
`channel` starts with `broadcast:`.

Cancellation is available both through `cosmos_bot_broadcast_cancel` and, for a broadcast
started while the owner is chatting, through `.cancel` — the job is registered in
`cancellationManager` under the `broadcast` feature (Rule N).

---

## 8. Client configuration

All four clients share the **same** single owner key. There is no per-client key to issue,
rotate, or revoke. Source the key from the environment; never commit it.

Copy-paste-ready examples for every client are committed in
[`docs/mcp/`](mcp/) (`README.md` plus `opencode.example.json`,
`pi.example.json`, `antigravity.example.json`, and `remote-http.example.json`);
the Claude Code config lives at the repository root as `.mcp.json`.

### Claude Code (`.mcp.json`, committed to the repository)

```json
{
    "mcpServers": {
        "cosmos": {
            "command": "pnpm",
            "args": ["mcp:start"],
            "env": { "COSMOS_MCP_TOKEN": "${COSMOS_MCP_TOKEN}" }
        }
    }
}
```

Equivalent CLI: `claude mcp add --transport stdio cosmos -- pnpm mcp:start`

### OpenCode

Add to your OpenCode MCP configuration (`opencode.json`, user-level or project-level):

```json
{
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
        "cosmos": {
            "type": "local",
            "command": ["pnpm", "mcp:start"],
            "environment": { "COSMOS_MCP_TOKEN": "{env:COSMOS_MCP_TOKEN}" },
            "enabled": true
        }
    }
}
```

For a remote deployment, use the HTTP form instead:

```json
"cosmos": {
  "type": "remote",
  "url": "http://127.0.0.1:4100/mcp",
  "headers": { "x-internal-secret": "{env:COSMOS_MCP_TOKEN}" },
  "enabled": true
}
```

### Pi

```json
{
    "mcpServers": [
        {
            "name": "cosmos",
            "command": "pnpm",
            "args": ["mcp:start"],
            "env": { "COSMOS_MCP_TOKEN": "${COSMOS_MCP_TOKEN}" }
        }
    ]
}
```

### Google Antigravity

```json
{
    "mcpServers": {
        "cosmos": {
            "command": "node",
            "args": ["dist/mcp/index.js"],
            "env": { "COSMOS_MCP_TOKEN": "${COSMOS_MCP_TOKEN}" }
        }
    }
}
```

### Remote clients

Forward the container's loopback port over SSH and use the HTTP transport:

```bash
ssh -N -L 4100:127.0.0.1:4100 user@cosmos-host
```

Then point the client at `http://127.0.0.1:4100/mcp` with the `x-internal-secret` header.

---

## 9. Deployment

The `cosmos-mcp` PM2 app is declared in `docker/ecosystem.config.cjs`, runs from
`/app/bot/dist/mcp/index.js --transport=http`, and is skipped automatically when the bot build
was not packaged into the image.

Verify after `docker compose build cosmos-origin && docker compose up -d`:

```bash
pm2 list | grep cosmos-mcp
docker exec cosmos-origin pm2 logs cosmos-mcp --lines 20
docker exec cosmos-origin sh -c 'grep -rl "cosmos_bot_broadcast" /app/bot/dist/mcp | head'
# From inside the container only (loopback):
docker exec cosmos-origin curl -s -o /dev/null -w '%{http_code}\n' \
  -H "x-internal-secret: $COSMOS_MCP_TOKEN" http://127.0.0.1:4100/healthz
```

### Read-only deployment

```bash
COSMOS_MCP_READ_ONLY=true docker compose up -d
```

The mutating toolset is compiled out of the server entirely, so it is not merely refused at
call time. `cosmos_db_apply_mutation`, `cosmos_bot_broadcast`,
`cosmos_bot_send_message`, `cosmos_bot_reconnect`, `cosmos_bot_logout`,
`cosmos_bot_broadcast_cancel`, `cosmos_settings_set`, and `cosmos_feature_invoke` all disappear
from `tools/list`.

---

## 10. Key rotation procedure (owner-only)

1. Generate a new value in the secret manager (Doppler / container `.env`).
2. `docker compose up -d` (or restart the relevant PM2 app) to load it.
3. Reconfigure **every** client — they all reference the same variable, so there is nothing
   per-client to update.
4. Confirm revocation: `pm2 logs cosmos-mcp` shows the new fingerprint in the
   `Server ready for repository-owner` line, and any old key now yields `401 UNAUTHORIZED_MCP`.
5. If the key was lost, there is **no** recovery path. Perform a full owner-side rotation.

Because `ActivityLog` records the holder rather than the credential, the audit trail remains
valid across rotations.

---

## 11. Tests

```bash
npx tsx --test tests/cosmosMcp.test.ts   # 46 unit / integration assertions
node tests/smoke/cosmosMcpSmoke.mjs     # end-to-end MCP stdio protocol check
```

The smoke test spawns the real server process and asserts the fail-closed start-up path, the
tool listing, the guardrail refusals, the plan fingerprint gate, and `BOT_OFFLINE` semantics
for live bot actions.

---

## 12. Error codes

| Code                    | Meaning                                                                                       |
| :---------------------- | :-------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED_MCP`      | Missing, empty, or mismatched owner key. Also returned when the server has no key configured. |
| `FORBIDDEN_TABLE`       | The table stores credential material and is never readable or writable.                       |
| `FORBIDDEN_COLUMN`      | The column stores credential material; an explicit projection is mandatory.                   |
| `FORBIDDEN_SQL`         | Not a single read-only `SELECT`.                                                              |
| `MISSING_WHERE_CLAUSE`  | A high-value ledger table was queried without a filter.                                       |
| `INVALID_SQL`           | SQLite rejected the statement, or a mandatory `LIMIT` was absent.                             |
| `UNKNOWN_MODEL`         | The model does not exist in `prisma/schema.prisma`.                                           |
| `UNSAFE_MUTATION`       | The planner refused, or the bulk-delete ceiling was exceeded.                                 |
| `PLAN_REQUIRED`         | The supplied plan fingerprint does not match the mutation.                                    |
| `CONFIRMATION_REQUIRED` | A destructive or live operation needs `confirm: true`.                                        |
| `READ_ONLY_MODE`        | The deployment compiles mutating tools out.                                                   |
| `RATE_LIMITED`          | Call, mutation, or concurrency ceiling exceeded.                                              |
| `BOT_OFFLINE`           | The bot engine is unreachable. Never substituted with fabricated data.                        |
| `INVALID_PAYLOAD`       | The request failed validation.                                                                |
| `NOT_FOUND`             | The requested resource does not exist.                                                        |
| `INTERNAL_ERROR`        | Unexpected failure.                                                                           |

---

## 13. Deliberate limitations

- **stdio authorisation is process-scoped.** stdio has no per-request header, so its control is
  "only the owner's environment can start this process". Use the HTTP transport for any remote
  or shared-machine scenario.
- **Pairing and QR remain engine-exclusive.** `cosmos_bot_subbot_*` only proxies real values and
  returns `BOT_OFFLINE` when the engine is down (Rule Y).
- **`cosmos_feature_invoke` cannot emulate a real chat.** It validates the invocation and, for
  safe operations, runs the handler with a null socket. Conversational features that genuinely
  require a Baileys socket must be exercised from WhatsApp.
- **The DDL mirror check is static.** `cosmos_schema_check` parses `src/db.ts` and
  `.worktrees/api/src/db.ts` textually. It reports honestly when the sibling worktree is absent
  (as in a fresh clone) rather than assuming symmetry.

## 14. MCP alert notifier

The MCP surface emits operational and security alerts through the
existing external status channels (Discord, Slack, WhatsApp — see the
status-notifier subsystem, Issue #47). Because the WhatsApp transport
requires the bot process's Baileys socket, alerts are forwarded over
the authenticated IPC bridge to a `/internal/mcp/alert` route, which
validates and dispatches them through the regular `notify()` fan-out
with `StatusNotificationLog` persistence and outbox retry.

| Event                    | Severity | Trigger                                                                                                       |
| :----------------------- | :------- | :------------------------------------------------------------------------------------------------------------ |
| `MCP_SERVER_STARTED`     | INFO     | Server ready on its transport                                                                                 |
| `MCP_AUTH_REJECTED`      | CRITICAL | ≥3 rejected requests within a rolling 5-minute window                                                         |
| `MCP_RATE_LIMITED`       | WARN     | Caller hit a call, mutation, or concurrency limit                                                             |
| `MCP_MUTATION_BLOCKED`   | WARN     | Safety gate refused a mutation (`UNSAFE_MUTATION`, `UNKNOWN_FIELD`, `PLAN_REQUIRED`, `CONFIRMATION_REQUIRED`) |
| `MCP_MUTATION_APPLIED`   | INFO     | Mutation executed (audit trail)                                                                               |
| `MCP_TOOL_ERROR`         | WARN     | Tool failure with any other error code                                                                        |
| `MCP_ENGINE_UNREACHABLE` | CRITICAL | IPC bridge failed at the transport layer                                                                      |

Notes:

- With the default `STATUS_NOTIFY_MIN_SEVERITY=WARN`, INFO events are
  filtered from the channels but still persisted to the log. Set the
  variable to `INFO` to receive startup and mutation-applied alerts.
- Alerts are deduplicated per event class (10–60 minute windows), so a
  probing client cannot flood the channels.
- Payloads carry only sanitized, low-cardinality fields (tool names,
  error codes, transport, row counts). No credentials, JIDs, phone
  numbers, or tool arguments; the channel formatters' identifier
  redaction remains the outbound backstop (Rule AG).
- The IPC route accepts only `MCP_*` events, is authenticated with the
  constant-time `INTERNAL_IPC_SECRET` check like every `/internal/...`
  route, and length-caps every field.
- Alerting never fails a tool call: if the bridge is unreachable the
  alert is dropped with a deduped console warning.
