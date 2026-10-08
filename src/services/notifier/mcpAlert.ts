/**
 * MCP Alert Notifier — shared request contract.
 *
 * The MCP server process forwards sanitized alert requests over the
 * authenticated IPC bridge; the bot process validates them here and
 * dispatches them through the regular `notify()` fan-out, which is
 * what makes the WhatsApp channel reachable (the Baileys socket only
 * exists in the bot process).
 *
 * This module is intentionally pure: no I/O, no clock, no globals —
 * so the exact validation the IPC route performs is unit-testable.
 */
import {
    NOTIFY_EVENTS,
    NOTIFY_SEVERITIES,
    type NotifyEvent,
    type NotifyPayload,
    type NotifySeverity
} from './types.js';

/**
 * The events the MCP alert surface may emit. Restricted to the `MCP_`
 * namespace so the IPC route cannot be used to inject arbitrary
 * notification events, even by a caller that holds the IPC secret.
 */
export const MCP_NOTIFY_EVENTS = [
    'MCP_SERVER_STARTED',
    'MCP_AUTH_REJECTED',
    'MCP_RATE_LIMITED',
    'MCP_MUTATION_BLOCKED',
    'MCP_MUTATION_APPLIED',
    'MCP_TOOL_ERROR',
    'MCP_ENGINE_UNREACHABLE'
] as const;

export type McpNotifyEvent = (typeof MCP_NOTIFY_EVENTS)[number];

/** Length caps keep a single alert from flooding every channel. */
const SUMMARY_MAX = 200;
const DETAIL_MAX_LINES = 10;
const DETAIL_MAX_LENGTH = 500;
const FIELD_KEY_MAX = 40;
const FIELD_VALUE_MAX = 500;
const DEDUPE_KEY_MAX = 120;

export interface McpAlertRequest {
    event: NotifyEvent;
    severity: NotifySeverity;
    payload: NotifyPayload;
    options: {
        dedupeKey?: string;
        dedupeWindowMs?: number;
    };
}

export type McpAlertParseResult = { ok: true; request: McpAlertRequest } | { ok: false; reason: string };

function isMember(value: unknown, members: readonly string[]): boolean {
    return typeof value === 'string' && members.includes(value);
}

/**
 * Validates a raw IPC request body into a typed alert request.
 *
 * Accepts only `MCP_*` events and only sanitized, low-cardinality
 * payload fields. Every string is length-capped; nothing here is
 * trusted to be PII-free by construction — the channel formatters
 * still run `redactIdentifiers` as the outbound backstop (Rule AG).
 */
export function parseMcpAlertRequest(body: Record<string, unknown>): McpAlertParseResult {
    if (!isMember(body.event, MCP_NOTIFY_EVENTS)) {
        return { ok: false, reason: `event must be one of: ${MCP_NOTIFY_EVENTS.join(', ')}` };
    }
    if (!isMember(body.severity, NOTIFY_SEVERITIES)) {
        return { ok: false, reason: `severity must be one of: ${NOTIFY_SEVERITIES.join(', ')}` };
    }

    const summary = body.summary;
    if (typeof summary !== 'string' || summary.trim().length === 0) {
        return { ok: false, reason: 'summary is required' };
    }
    if (summary.length > SUMMARY_MAX) {
        return { ok: false, reason: `summary must be at most ${SUMMARY_MAX} characters` };
    }

    const details = body.details;
    if (details !== undefined) {
        if (!Array.isArray(details) || details.length > DETAIL_MAX_LINES) {
            return { ok: false, reason: `details must be an array of at most ${DETAIL_MAX_LINES} strings` };
        }
        for (const line of details) {
            if (typeof line !== 'string' || line.length > DETAIL_MAX_LENGTH) {
                return {
                    ok: false,
                    reason: `each detail line must be a string of at most ${DETAIL_MAX_LENGTH} characters`
                };
            }
        }
    }

    const rawFields = body.fields;
    const fields: Record<string, string | number | boolean | null> | undefined = {};
    if (rawFields !== undefined) {
        if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
            return { ok: false, reason: 'fields must be a flat object of scalars' };
        }
        for (const [key, value] of Object.entries(rawFields as Record<string, unknown>)) {
            if (key.length > FIELD_KEY_MAX) {
                return { ok: false, reason: `field keys must be at most ${FIELD_KEY_MAX} characters` };
            }
            if (
                value !== null &&
                typeof value !== 'string' &&
                typeof value !== 'number' &&
                typeof value !== 'boolean'
            ) {
                return { ok: false, reason: 'field values must be strings, numbers, booleans, or null' };
            }
            if (typeof value === 'string' && value.length > FIELD_VALUE_MAX) {
                return { ok: false, reason: `field values must be at most ${FIELD_VALUE_MAX} characters` };
            }
            fields[key] = value as string | number | boolean | null;
        }
    }

    const dedupeKey = body.dedupeKey;
    if (dedupeKey !== undefined && (typeof dedupeKey !== 'string' || dedupeKey.length > DEDUPE_KEY_MAX)) {
        return { ok: false, reason: `dedupeKey must be a string of at most ${DEDUPE_KEY_MAX} characters` };
    }

    const dedupeWindowMs = body.dedupeWindowMs;
    if (dedupeWindowMs !== undefined) {
        if (typeof dedupeWindowMs !== 'number' || !Number.isFinite(dedupeWindowMs) || dedupeWindowMs < 0) {
            return { ok: false, reason: 'dedupeWindowMs must be a non-negative number' };
        }
    }

    // Belt and braces: the event must exist in the dispatcher's union,
    // otherwise outbox retries would terminally fail on it.
    if (!isMember(body.event, NOTIFY_EVENTS)) {
        return { ok: false, reason: 'event is not registered in NOTIFY_EVENTS' };
    }

    return {
        ok: true,
        request: {
            event: body.event as NotifyEvent,
            severity: body.severity as NotifySeverity,
            payload: {
                summary,
                ...(Array.isArray(details) ? { details: details as string[] } : {}),
                ...(rawFields !== undefined ? { fields } : {}),
                sessionId: 'mcp'
            },
            options: {
                ...(typeof dedupeKey === 'string' ? { dedupeKey } : {}),
                ...(typeof dedupeWindowMs === 'number' ? { dedupeWindowMs } : {})
            }
        }
    };
}
