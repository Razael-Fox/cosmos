/**
 * External Status Notification subsystem — fan-out dispatcher.
 *
 * Dispatch contract:
 *   1. Always emit a sanitized line to the console first (Pterodactyl visibility).
 *   2. Apply the minimum-severity filter to external channels.
 *   3. Fan out to every enabled transport in parallel via `Promise.allSettled`.
 *   4. Persist a delivery record to `StatusNotificationLog`.
 *   5. Enqueue any failed delivery into the persistent outbox for retry.
 *
 * Nothing in this module throws into its callers: a broken status channel must
 * never take down the bot that it is supposed to be monitoring.
 */
import { getVersionInfo } from '#utils/versioning.js';
import { prisma } from '#db.js';
import { getStatusNotifierConfig, logStatusNotifierConfig } from './config.js';
import { getEventTitle, getSeverityIcon } from './formatters.js';
import { sendDiscord } from './transports/discord.js';
import { sendSlack } from './transports/slack.js';
import { sendWhatsApp } from './transports/whatsappChannel.js';
import { enqueueOutbox } from './outbox.js';
import {
    NOTIFY_SEVERITIES,
    type DeliveryResult,
    type NotifyChannel,
    type NotifyEvent,
    type NotifyPayload,
    type NotifySeverity
} from './types.js';

type Transport = (event: NotifyEvent, severity: NotifySeverity, payload: NotifyPayload) => Promise<DeliveryResult>;

const TRANSPORTS: Record<NotifyChannel, Transport> = {
    discord: sendDiscord,
    slack: sendSlack,
    whatsapp: sendWhatsApp
};

const SEVERITY_RANK: Record<NotifySeverity, number> = {
    INFO: 0,
    WARN: 1,
    CRITICAL: 2
};

export interface NotifyOptions {
    /** Dedupe key; identical keys inside `dedupeWindowMs` are suppressed. */
    dedupeKey?: string;
    /** Dedupe window in milliseconds (default 10 minutes). */
    dedupeWindowMs?: number;
    /** Force dispatch even below the configured minimum severity. */
    force?: boolean;
}

const dedupeRegistry = new Map<string, number>();
const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function resolveVersion(): string {
    try {
        return getVersionInfo().version;
    } catch {
        return 'unknown';
    }
}

function isDeduped(key: string | undefined, windowMs: number): boolean {
    if (!key) return false;
    const now = Date.now();
    const last = dedupeRegistry.get(key);
    if (last !== undefined && now - last < windowMs) return true;
    dedupeRegistry.set(key, now);

    // Bound the registry so it cannot grow without limit.
    if (dedupeRegistry.size > 500) {
        for (const [k, ts] of dedupeRegistry.entries()) {
            if (now - ts > windowMs) dedupeRegistry.delete(k);
        }
    }
    return false;
}

/** Clears a dedupe key so the next matching event dispatches immediately (used on recovery). */
export function clearDedupeKey(key: string): void {
    dedupeRegistry.delete(key);
}

async function persistLog(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload,
    results: DeliveryResult[],
    localOnly: boolean
): Promise<void> {
    const external = results.filter((r) => !r.skipped);
    const delivered = external.filter((r) => r.success);
    let status: string;
    if (localOnly || external.length === 0) status = 'LOCAL_ONLY';
    else if (delivered.length === external.length) status = 'DELIVERED';
    else if (delivered.length > 0) status = 'PARTIAL';
    else status = 'FAILED';

    try {
        await prisma.statusNotificationLog.create({
            data: {
                event,
                severity,
                summary: payload.summary.slice(0, 1000),
                status,
                channels: JSON.stringify(results),
                version: resolveVersion()
            }
        });
    } catch (err) {
        console.error('[StatusNotifier] Failed to persist notification log:', err);
    }
}

/**
 * Dispatches a sanitized notification to all enabled external channels.
 * Resolves to the per-channel delivery results (never rejects).
 */
export async function notify(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload,
    options: NotifyOptions = {}
): Promise<DeliveryResult[]> {
    const config = getStatusNotifierConfig();
    logStatusNotifierConfig();

    const version = payload.version ?? resolveVersion();
    const enriched: NotifyPayload = {
        ...payload,
        version,
        timestamp: payload.timestamp ?? new Date().toISOString()
    };

    console.log(
        `[StatusNotifier] ${getSeverityIcon(severity)} ${getEventTitle(event)} [${severity}] ${enriched.summary}`
    );

    const belowMin = !options.force && SEVERITY_RANK[severity] < SEVERITY_RANK[config.minSeverity];

    if (!config.enabled || belowMin) {
        await persistLog(event, severity, enriched, [], true);
        return [];
    }

    // Dedupe applies to external fan-out only; the console line above always fires.
    const dedupeWindow = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    if (isDeduped(options.dedupeKey ?? payload.dedupeKey, dedupeWindow)) {
        console.log(`[StatusNotifier] Suppressed duplicate ${event} within dedupe window.`);
        return [{ channel: 'discord', success: false, skipped: true, error: 'deduped' }];
    }

    const enabledChannels = (Object.keys(TRANSPORTS) as NotifyChannel[]).filter((channel) => {
        if (channel === 'discord') return config.discord.enabled;
        if (channel === 'slack') return config.slack.enabled;
        return config.whatsapp.enabled;
    });

    const settled = await Promise.allSettled(
        enabledChannels.map((channel) => TRANSPORTS[channel](event, severity, enriched))
    );

    const results: DeliveryResult[] = settled.map((outcome, index) => {
        const channel = enabledChannels[index];
        if (outcome.status === 'fulfilled') return outcome.value;
        return {
            channel,
            success: false,
            error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
        };
    });

    // Enqueue failures for persistent retry.
    for (const result of results) {
        if (!result.success && !result.skipped) {
            await enqueueOutbox(event, severity, result.channel, enriched, result.error);
        }
    }

    await persistLog(event, severity, enriched, results, false);
    return results;
}

/** Sends a test notification and returns the per-channel delivery results. */
export async function notifyTest(summary = 'Manual status channel connectivity test.'): Promise<DeliveryResult[]> {
    return notify(
        'TEST',
        'INFO',
        { summary, details: ['Triggered from the .status notify command.'], sessionId: 'default' },
        { force: true }
    );
}

/** Returns a sanitized channel-health snapshot for operator display. */
export function getChannelHealth(): Array<{ channel: NotifyChannel; enabled: boolean; configured: boolean }> {
    const config = getStatusNotifierConfig();
    return [
        {
            channel: 'discord',
            enabled: config.discord.enabled,
            configured: !!config.discord.webhookUrl
        },
        {
            channel: 'slack',
            enabled: config.slack.enabled,
            configured: !!config.slack.webhookUrl
        },
        {
            channel: 'whatsapp',
            enabled: config.whatsapp.enabled,
            configured: !!config.whatsapp.newsletterJid
        }
    ];
}

export { NOTIFY_SEVERITIES };
