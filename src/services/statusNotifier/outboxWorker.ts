/**
 * Persistent outbox retry worker.
 *
 * Cron-driven (Rule J: no in-memory setTimeout). Claims due rows, re-runs the
 * specific transport that originally failed, and reschedules or terminally
 * fails the row.
 */
import cron from 'node-cron';
import { getStatusNotifierConfig } from './config.js';
import { sendDiscord } from './transports/discord.js';
import { sendSlack } from './transports/slack.js';
import { sendWhatsApp } from './transports/whatsappChannel.js';
import { claimDueOutbox, markOutboxFailed, markOutboxSent, pruneOutbox, type OutboxEntry } from './outbox.js';
import type { NotifyChannel, NotifyEvent, NotifyPayload, NotifySeverity } from './types.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let running = false;

async function processEntry(entry: OutboxEntry): Promise<void> {
    let payload: NotifyPayload;
    try {
        payload = JSON.parse(entry.payload) as NotifyPayload;
    } catch {
        await markOutboxFailed(entry.id, entry.maxAttempts, entry.maxAttempts, 'invalid payload JSON');
        return;
    }

    const event = entry.event as NotifyEvent;
    const severity = entry.severity as NotifySeverity;
    const channel = entry.channel as NotifyChannel;

    let success = false;
    let error: string | undefined;
    try {
        const transport = channel === 'discord' ? sendDiscord : channel === 'slack' ? sendSlack : sendWhatsApp;
        const result = await transport(event, severity, payload);
        success = result.success;
        error = result.error;
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }

    const attempts = (entry.attempts ?? 0) + 1;
    if (success) {
        await markOutboxSent(entry.id);
    } else {
        await markOutboxFailed(entry.id, attempts, entry.maxAttempts ?? getStatusNotifierConfig().maxAttempts, error);
    }
}

/** Processes a single retry batch. Never throws. */
export async function processOutboxBatch(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const entries = await claimDueOutbox();
        for (const entry of entries) {
            await processEntry(entry);
        }
        await pruneOutbox();
    } catch (err) {
        console.error('[StatusNotifier] Outbox retry batch failed:', err);
    } finally {
        running = false;
    }
}

/** Starts the cron-driven outbox retry worker. */
export function startOutboxWorker(): void {
    if (task) return;
    const config = getStatusNotifierConfig();
    task = cron.schedule(config.outboxCronExpression, () => {
        void processOutboxBatch();
    });
    console.log(`[StatusNotifier] Outbox retry worker started (cron "${config.outboxCronExpression}").`);
}

export function stopOutboxWorker(): void {
    if (task) {
        task.stop();
        task = null;
    }
}
