/**
 * External Status Notification subsystem — configuration resolver.
 *
 * Secrets/webhooks are resolved exclusively from environment variables (Doppler
 * in production). Every value is fail-closed: an unset webhook disables only its
 * own channel while local console logging continues to work.
 */
import { NOTIFY_SEVERITIES, type NotifySeverity } from './types.js';

export interface StatusNotifierConfig {
    /** Master switch. When false, only console logging happens. */
    enabled: boolean;
    discord: {
        enabled: boolean;
        webhookUrl: string | null;
    };
    slack: {
        enabled: boolean;
        webhookUrl: string | null;
    };
    whatsapp: {
        enabled: boolean;
        /** Newsletter/channel JID (e.g. `1234567890@newsletter`). */
        newsletterJid: string | null;
        /** Owner JID used as a DM fallback when the channel send fails. */
        ownerJid: string | null;
        /** Whether to fall back to an owner direct message. */
        fallbackToOwnerDm: boolean;
    };
    backupArtifacts: {
        /**
         * Explicit opt-in for uploading the raw SQLite snapshot to file-capable
         * status channels (Discord, WhatsApp). Defaults to off: the database
         * contains session credentials and financial records, so exfiltration
         * to broad channel audiences requires a deliberate decision.
         */
        enabled: boolean;
    };
    /** Minimum severity that gets dispatched to external channels. */
    minSeverity: NotifySeverity;
    /** Cron expression for the outbox retry worker. */
    outboxCronExpression: string;
    /** Cron expression for the audit digest. */
    auditDigestCronExpression: string;
    /** Per-request HTTP timeout in milliseconds. */
    requestTimeoutMs: number;
    /** Maximum delivery attempts per notification. */
    maxAttempts: number;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined || raw.trim() === '') return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function parseSeverity(raw: string | undefined, fallback: NotifySeverity): NotifySeverity {
    if (!raw) return fallback;
    const normalized = raw.trim().toUpperCase();
    return (NOTIFY_SEVERITIES as readonly string[]).includes(normalized) ? (normalized as NotifySeverity) : fallback;
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
    for (const value of values) {
        if (value && value.trim().length > 0) return value.trim();
    }
    return null;
}

/**
 * Masks a webhook/secret for safe logging. Only the tail is ever revealed so an
 * operator can confirm which credential is configured without leaking it.
 */
export function maskSecret(secret: string | null | undefined): string {
    if (!secret) return '(unset)';
    if (secret.length <= 8) return '••••';
    return `••••${secret.slice(-6)}`;
}

let cached: StatusNotifierConfig | null = null;

/**
 * Resolves the status notifier configuration from environment variables.
 * Results are memoized; pass `forceReload: true` to re-read the environment.
 */
export function getStatusNotifierConfig(forceReload = false): StatusNotifierConfig {
    if (cached && !forceReload) return cached;

    const masterEnabled = parseBoolean(process.env.STATUS_NOTIFY_ENABLED, true);

    const discordUrl = firstNonEmpty(process.env.DISCORD_STATUS_WEBHOOK_URL);
    const slackUrl = firstNonEmpty(process.env.SLACK_STATUS_WEBHOOK_URL);
    const newsletterJid = firstNonEmpty(process.env.WA_STATUS_NEWSLETTER_JID, process.env.WA_STATUS_CHANNEL_ID);
    // Explicit owner JID only. The transport resolves the primary owner number
    // via getOwnerNumbers() when unset, so a comma-separated
    // OWNER_PHONE_NUMBER list is never mangled into a single invalid JID.
    const ownerJid = firstNonEmpty(process.env.WA_STATUS_OWNER_JID);

    cached = {
        enabled: masterEnabled,
        discord: {
            enabled: masterEnabled && parseBoolean(process.env.DISCORD_STATUS_ENABLED, true) && !!discordUrl,
            webhookUrl: discordUrl
        },
        slack: {
            enabled: masterEnabled && parseBoolean(process.env.SLACK_STATUS_ENABLED, true) && !!slackUrl,
            webhookUrl: slackUrl
        },
        whatsapp: {
            enabled: masterEnabled && parseBoolean(process.env.WA_STATUS_ENABLED, true) && !!newsletterJid,
            newsletterJid,
            ownerJid,
            fallbackToOwnerDm: parseBoolean(process.env.WA_STATUS_FALLBACK_DM, true)
        },
        minSeverity: parseSeverity(process.env.STATUS_NOTIFY_MIN_SEVERITY, 'WARN'),
        backupArtifacts: {
            enabled: masterEnabled && parseBoolean(process.env.STATUS_NOTIFY_BACKUP_ARTIFACTS_ENABLED, false)
        },
        outboxCronExpression: firstNonEmpty(process.env.STATUS_NOTIFY_OUTBOX_CRON) ?? '*/2 * * * *',
        auditDigestCronExpression: firstNonEmpty(process.env.STATUS_NOTIFY_DIGEST_CRON) ?? '0 23 * * *',
        requestTimeoutMs: Number(process.env.STATUS_NOTIFY_TIMEOUT_MS) || 10000,
        maxAttempts: Number(process.env.STATUS_NOTIFY_MAX_ATTEMPTS) || 3
    };

    return cached;
}

let loggedConfig = false;

/**
 * Emits a one-time sanitized configuration summary to the console so the
 * Pterodactyl panel can confirm which channels are active.
 */
export function logStatusNotifierConfig(): void {
    if (loggedConfig) return;
    loggedConfig = true;
    const config = getStatusNotifierConfig();
    console.log(
        `[StatusNotifier] enabled=${config.enabled} minSeverity=${config.minSeverity} ` +
            `discord=${config.discord.enabled}(${maskSecret(config.discord.webhookUrl)}) ` +
            `slack=${config.slack.enabled}(${maskSecret(config.slack.webhookUrl)}) ` +
            `whatsapp=${config.whatsapp.enabled}(${config.whatsapp.newsletterJid ?? '(unset)'}) ` +
            `backupArtifacts=${config.backupArtifacts.enabled}`
    );
}

/** Test helper: clears the memoized config so env-var changes are picked up. */
export function resetStatusNotifierConfigCache(): void {
    cached = null;
    loggedConfig = false;
}
