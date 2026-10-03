/**
 * External Status Notification subsystem — shared types.
 *
 * All outbound payloads are deliberately restricted to sanitized, low-cardinality
 * fields. Raw JIDs, phone numbers, credentials, and message bodies must never be
 * placed on a `NotifyPayload` (Rule AG — zero-knowledge outbound).
 */

/** Severity ordering used for the minimum-severity filter (INFO < WARN < CRITICAL). */
export const NOTIFY_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;

export type NotifySeverity = (typeof NOTIFY_SEVERITIES)[number];

/** Deterministic event identifiers emitted by the health, guard, and forwarding layers. */
export const NOTIFY_EVENTS = [
    'BOT_DOWN',
    'BOT_RECONNECTED',
    'DB_MISSING',
    'DB_CORRUPT',
    'DB_BACKUP_SUCCESS',
    'DB_BACKUP_FAILED',
    'STATUS_DEGRADED',
    'AUDIT_DIGEST',
    'ISSUE_LOG',
    'TEST',
    // MCP alert notifier — emitted by the MCP server process and
    // forwarded over the IPC bridge (see src/mcp/alerts.ts).
    'MCP_SERVER_STARTED',
    'MCP_AUTH_REJECTED',
    'MCP_RATE_LIMITED',
    'MCP_MUTATION_BLOCKED',
    'MCP_MUTATION_APPLIED',
    'MCP_TOOL_ERROR',
    'MCP_ENGINE_UNREACHABLE'
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type NotifyChannel = 'discord' | 'slack' | 'whatsapp';

/**
 * Sanitized notification payload. `fields` is a flat record of already-humanized
 * (and already-redacted) key/value pairs rendered by the per-channel formatters.
 */
export interface NotifyPayload {
    /** Deterministic incident/event key used for dedupe (e.g. `BOT_DOWN:default`). */
    dedupeKey?: string;
    /** Short one-line summary. */
    summary: string;
    /** Optional free-form detail lines. Never contains PII. */
    details?: string[];
    /** Structured, sanitized key/value pairs for embed/block rendering. */
    fields?: Record<string, string | number | boolean | null | undefined>;
    /** Cosmos build version at emission time. */
    version?: string;
    /** Session/identifier that originated the event (e.g. `default`, `sub_...`). */
    sessionId?: string;
    /** File/line citation for forwarded issue logs. */
    location?: string;
    /** ISO timestamp; filled by the dispatcher when omitted. */
    timestamp?: string;
}

/** Result of a single transport delivery attempt. */
export interface DeliveryResult {
    channel: NotifyChannel;
    success: boolean;
    skipped?: boolean;
    error?: string;
    attempts?: number;
}
