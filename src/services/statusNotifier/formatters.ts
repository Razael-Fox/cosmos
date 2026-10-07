/**
 * External Status Notification subsystem — channel renderers.
 *
 * Each renderer converts a sanitized `NotifyPayload` into the native wire format
 * of its channel. Renderers are pure and must never throw for malformed input;
 * they degrade to a minimal text representation instead.
 */
import { formatRupiah, formatNumberId } from '#utils/currency.js';
import type { NotifyEvent, NotifyPayload, NotifySeverity } from './types.js';

const DISCORD_COLORS: Record<NotifySeverity, number> = {
    INFO: 0x3498db,
    WARN: 0xf1c40f,
    CRITICAL: 0xe74c3c
};

const SEVERITY_ICONS: Record<NotifySeverity, string> = {
    INFO: 'ℹ️',
    WARN: '⚠️',
    CRITICAL: '🚨'
};

const EVENT_TITLES: Record<NotifyEvent, string> = {
    BOT_DOWN: 'Bot Down',
    BOT_RECONNECTED: 'Bot Reconnected',
    BOT_STARTED: 'Bot Started',
    BOT_RESTARTED: 'Bot Restarted',
    BOT_STOPPED: 'Bot Stopped',
    SERVER_BOOTED: 'Server Booted',
    SERVER_REBOOTED: 'Server Rebooted',
    DB_MISSING: 'Database Missing',
    DB_CORRUPT: 'Database Corrupt',
    DB_BACKUP_SUCCESS: 'Database Backup Delivered',
    DB_BACKUP_FAILED: 'Database Backup Failed',
    STATUS_DEGRADED: 'Status Degraded',
    AUDIT_DIGEST: 'Daily Audit Digest',
    ISSUE_LOG: 'Operational Issue Log',
    TEST: 'Status Channel Test',
    MCP_SERVER_STARTED: 'MCP Server Started',
    MCP_AUTH_REJECTED: 'MCP Authentication Rejections',
    MCP_RATE_LIMITED: 'MCP Rate Limit Reached',
    MCP_MUTATION_BLOCKED: 'MCP Mutation Blocked',
    MCP_MUTATION_APPLIED: 'MCP Mutation Applied',
    MCP_TOOL_ERROR: 'MCP Tool Error',
    MCP_ENGINE_UNREACHABLE: 'MCP Bot Engine Unreachable'
};

export interface NotifyEventInput {
    event: NotifyEvent;
    severity: NotifySeverity;
    payload: NotifyPayload;
}

/** Human-readable event title. */
export function getEventTitle(event: NotifyEvent): string {
    return EVENT_TITLES[event] ?? event;
}

/** Severity icon used across text renderers. */
export function getSeverityIcon(severity: NotifySeverity): string {
    return SEVERITY_ICONS[severity] ?? 'ℹ️';
}

const JID_PATTERN = /(\d{5,15})(?:@(?:s\.whatsapp\.net|lid|g\.us|c\.us|newsletter))?/g;

/**
 * Redacts anything that looks like a phone number / WhatsApp JID from an
 * outbound string. Message bodies and structured fields should already avoid
 * PII; this is a defense-in-depth backstop before data leaves the process.
 */
export function redactIdentifiers(input: string): string {
    return input
        .replace(/(?:\+?\d[\s.-]?){7,15}\d/g, '[redacted-number]')
        .replace(JID_PATTERN, (match, digits: string) =>
            match.includes('@') ? `[redacted-jid:${digits.slice(-2)}]` : '[redacted-number]'
        );
}

/** Returns the payload timestamp, defaulting to the current time. */
function timestampOf(payload: NotifyPayload): string {
    return payload.timestamp ?? new Date().toISOString();
}

/** Flattens sanitized details and fields into redacted display lines. */
function assembleLines(payload: NotifyPayload): string[] {
    const lines: string[] = [];
    if (payload.details && payload.details.length > 0) {
        for (const detail of payload.details) {
            lines.push(redactIdentifiers(detail));
        }
    }
    if (payload.fields) {
        for (const [key, value] of Object.entries(payload.fields)) {
            if (value === undefined || value === null) continue;
            lines.push(`${key}: ${redactIdentifiers(String(value))}`);
        }
    }
    return lines;
}

/* -------------------------------------------------------------------------- */
/* Discord                                                                     */
/* -------------------------------------------------------------------------- */

export interface DiscordWebhookBody {
    username: string;
    embeds: Array<{
        title: string;
        description: string;
        color: number;
        timestamp: string;
        footer: { text: string };
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
    }>;
}

export function formatDiscordEmbed(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload
): DiscordWebhookBody {
    const description = redactIdentifiers(payload.summary);
    const fields = payload.fields
        ? Object.entries(payload.fields)
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([name, value]) => ({
                  name,
                  value: redactIdentifiers(String(value)).slice(0, 1024) || '—',
                  inline: true
              }))
        : undefined;

    const footerParts = [`Cosmos ${payload.version ?? 'unknown'}`, `severity ${severity}`];
    if (payload.sessionId) footerParts.push(`session ${redactIdentifiers(payload.sessionId)}`);

    return {
        username: 'Cosmos Status',
        embeds: [
            {
                title: `${getSeverityIcon(severity)} ${getEventTitle(event)}`,
                description: description.slice(0, 4096) || '—',
                color: DISCORD_COLORS[severity],
                timestamp: timestampOf(payload),
                footer: { text: footerParts.join(' · ') },
                ...(fields ? { fields: fields.slice(0, 25) } : {})
            }
        ]
    };
}

/* -------------------------------------------------------------------------- */
/* Slack                                                                       */
/* -------------------------------------------------------------------------- */

export interface SlackWebhookBody {
    text: string;
    blocks: Array<Record<string, unknown>>;
}

export function formatSlackBlocks(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload
): SlackWebhookBody {
    const header = `${getSeverityIcon(severity)} ${getEventTitle(event)} — ${severity}`;
    const blocks: Array<Record<string, unknown>> = [
        {
            type: 'header',
            text: { type: 'plain_text', text: header, emoji: true }
        },
        {
            type: 'section',
            text: { type: 'mrkdwn', text: redactIdentifiers(payload.summary).slice(0, 2900) || '—' }
        }
    ];

    const lines = assembleLines(payload);
    if (lines.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: lines
                    .map((line) => `• ${line}`)
                    .join('\n')
                    .slice(0, 2900)
            }
        });
    }

    const contextParts = [`Cosmos ${payload.version ?? 'unknown'}`, timestampOf(payload)];
    if (payload.sessionId) contextParts.push(`session ${redactIdentifiers(payload.sessionId)}`);
    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: contextParts.join(' · ') }]
    });

    return {
        text: redactIdentifiers(`${getEventTitle(event)} [${severity}] ${payload.summary}`).slice(0, 300),
        blocks
    };
}

/* -------------------------------------------------------------------------- */
/* WhatsApp Channel (plain text)                                               */
/* -------------------------------------------------------------------------- */

const WA_MAX_LENGTH = 4096;

export function formatWhatsAppText(event: NotifyEvent, severity: NotifySeverity, payload: NotifyPayload): string {
    const header = `${getSeverityIcon(severity)} *${getEventTitle(event)}* [${severity}]`;
    const parts: string[] = [header, '', redactIdentifiers(payload.summary)];

    const lines = assembleLines(payload);
    if (lines.length > 0) {
        parts.push('');
        for (const line of lines) {
            parts.push(`• ${line}`);
        }
    }

    const contextParts = [`Cosmos ${payload.version ?? 'unknown'}`, timestampOf(payload)];
    if (payload.sessionId) contextParts.push(`session ${redactIdentifiers(payload.sessionId)}`);
    parts.push('', `_${contextParts.join(' · ')}_`);

    const text = parts.join('\n');
    return text.length > WA_MAX_LENGTH ? `${text.slice(0, WA_MAX_LENGTH - 20)}\n…(truncated)` : text;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Builds a sanitized single-line issue descriptor from an Error-like value.
 * Strips stack traces down to the first frame and redacts identifiers.
 */
export function buildIssueDetails(error: unknown): { summary: string; location?: string } {
    if (error instanceof Error) {
        const stackLine = error.stack?.split('\n')[1]?.trim();
        return {
            summary: redactIdentifiers(`${error.name}: ${error.message}`).slice(0, 500),
            location: stackLine ? redactIdentifiers(stackLine).slice(0, 300) : undefined
        };
    }
    const text = typeof error === 'string' ? error : JSON.stringify(error);
    return { summary: redactIdentifiers(text ?? 'Unknown error').slice(0, 500) };
}

export { formatRupiah, formatNumberId };
