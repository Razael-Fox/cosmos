# External Status Notifications

Cosmos ships a unified outbound status subsystem (`src/services/statusNotifier/`)
that mirrors operational events from the logger, health monitor, database guard,
backup pipeline, and audit trail to external channels.

The subsystem is **fail-closed**: any channel whose credentials are absent is
silently skipped, and local `console.log` / `console.error` output always works.
A broken status channel can never take down the bot it monitors.

---

## 1. Supported channels

| Channel          | Transport                                   | Configuration                |
| :--------------- | :------------------------------------------ | :--------------------------- |
| Discord          | Webhook POST (embeds)                       | `DISCORD_STATUS_WEBHOOK_URL` |
| Slack            | Incoming webhook POST (Block Kit)           | `SLACK_STATUS_WEBHOOK_URL`   |
| WhatsApp Channel | Live Baileys socket send, owner-DM fallback | `WA_STATUS_NEWSLETTER_JID`   |

All outbound payloads are sanitized: raw JIDs, phone numbers, credentials, and
message bodies are never transmitted. A defense-in-depth redactor
(`redactIdentifiers`) runs over every string immediately before it leaves the
process.

---

## 2. Events

| Event               | Severity      | Source                                   |
| :------------------ | :------------ | :--------------------------------------- |
| `BOT_DOWN`          | CRITICAL      | Health monitor / connection manager      |
| `BOT_RECONNECTED`   | INFO          | Health monitor / connection manager      |
| `DB_MISSING`        | CRITICAL      | Database guard                           |
| `DB_CORRUPT`        | CRITICAL      | Database guard                           |
| `DB_BACKUP_SUCCESS` | INFO          | Backup cycle                             |
| `DB_BACKUP_FAILED`  | CRITICAL      | Backup cycle                             |
| `STATUS_DEGRADED`   | WARN          | Health monitor / reconnect loop          |
| `AUDIT_DIGEST`      | INFO          | Audit digest cron (default 23:00 WIB)    |
| `ISSUE_LOG`         | WARN/CRITICAL | Batched runtime errors (5-minute window) |
| `TEST`              | INFO          | `.status notify`                         |

**Dedupe.** Each event carries a deterministic key. Identical keys inside the
configuration window are suppressed so one incident produces exactly one alert
plus one recovery message (suppressed duplicates return no channel results at
all). `BOT_DOWN` additionally has a 5-minute startup grace window so pairing/initial
connect does not trigger a false outage.

---

## 3. Environment variables

| Variable                     | Default       | Purpose                                                         |
| :--------------------------- | :------------ | :-------------------------------------------------------------- |
| `STATUS_NOTIFY_ENABLED`      | `true`        | Master switch (console logging always remains).                 |
| `STATUS_NOTIFY_MIN_SEVERITY` | `WARN`        | Minimum severity dispatched to external channels.               |
| `DISCORD_STATUS_WEBHOOK_URL` | —             | Discord webhook URL (empty = disabled).                         |
| `DISCORD_STATUS_ENABLED`     | `true`        | Per-channel toggle.                                             |
| `SLACK_STATUS_WEBHOOK_URL`   | —             | Slack incoming webhook URL (empty = disabled).                  |
| `SLACK_STATUS_ENABLED`       | `true`        | Per-channel toggle.                                             |
| `WA_STATUS_NEWSLETTER_JID`   | —             | WhatsApp channel JID, e.g. `1234567890@newsletter`.             |
| `WA_STATUS_CHANNEL_ID`       | —             | Alias for the channel JID.                                      |
| `WA_STATUS_ENABLED`          | `true`        | Per-channel toggle.                                             |
| `WA_STATUS_OWNER_JID`        | —             | Owner JID for DM fallback (falls back to `OWNER_PHONE_NUMBER`). |
| `WA_STATUS_FALLBACK_DM`      | `true`        | Enable owner-DM fallback when the channel send fails.           |
| `STATUS_NOTIFY_OUTBOX_CRON`  | `*/2 * * * *` | Outbox retry worker schedule.                                   |
| `STATUS_NOTIFY_DIGEST_CRON`  | `0 23 * * *`  | Audit digest schedule (WIB).                                    |
| `STATUS_NOTIFY_TIMEOUT_MS`   | `10000`       | Per-request HTTP timeout.                                       |
| `STATUS_NOTIFY_MAX_ATTEMPTS` | `3`           | Delivery attempts before outbox terminal failure.               |

Secrets are resolved from the environment (Doppler in production) and are masked
in logs (`••••xxxxxx`).

---

## 4. Persistence

Two Prisma SQLite models back the subsystem (see `prisma/schema.prisma` and the
programmatic DDL in `src/db.ts`):

- `StatusNotificationLog` — append-only delivery audit (event, severity, status,
  per-channel results, build version).
- `StatusNotificationOutbox` — persistent retry queue (Rule J: no in-memory
  `setTimeout`). Terminal rows are pruned after 7 days.

> **Dual maintenance (Rule W):** if the schema changes, update both `src/db.ts`
> (Bot) and `.worktrees/api/src/db.ts` (API Gateway) symmetrically.

---

## 5. Operator commands

Both commands are **owner-only** and registered under the System & Help category.

- `.status notify` — prints channel health and sends a `TEST` notification,
  showing per-channel delivery results.
- `.status report` — prints an on-demand health snapshot (database, Prisma, bot
  connection) plus a 24-hour audit digest with Rp-formatted sums.

---

## 6. Backups

The existing Telegram backup is unchanged. `runBackupCycle()` runs on startup and
daily at 00:00 WIB:

1. compute the SQLite SHA-256 digest;
2. upload to Telegram (unchanged behavior);
3. deliver the **raw SQLite snapshot** as a file attachment to file-capable
   channels (Discord via multipart webhook, WhatsApp via Baileys document send);
4. dispatch a **truthful** outcome alert: `DB_BACKUP_SUCCESS` only when Telegram
   uploaded, a file delivery succeeded, or the database was unchanged since the
   last backup; otherwise `DB_BACKUP_FAILED` (CRITICAL) with the hash and reason.

Slack incoming webhooks cannot upload files, so Slack receives the text alert
with the hash and reason only (file upload is tracked as a Phase 4 upgrade).

If Telegram is unconfigured, the status report is still dispatched — Telegram
absence no longer suppresses status reporting.

---

## 7. Outbox retry

Failed external deliveries are enqueued in `StatusNotificationOutbox` with
exponential backoff. The cron worker (`STATUS_NOTIFY_OUTBOX_CRON`, default every
2 minutes) re-runs the specific transport that failed. After
`STATUS_NOTIFY_MAX_ATTEMPTS`, the row is marked `FAILED` and later pruned.

---

## 8. Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm format
pnpm run version:check
```

To smoke-test a live deployment, run `.status notify` from the owner account and
confirm delivery lines for each configured channel.
