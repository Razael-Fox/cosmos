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
import { BROADCAST_CHANNEL_PREFIX, BROADCAST_EVENT } from '../broadcastService.js';
import {
    NOTIFY_EVENTS,
    NOTIFY_SEVERITIES,
    type NotifyChannel,
    type NotifyEvent,
    type NotifyPayload,
    type NotifySeverity
} from './types.js';

let task: ReturnType<typeof cron.schedule> | null = null;
let running = false;

const VALID_CHANNELS: readonly string[] = ['discord', 'slack', 'whatsapp'];

/** Retries a single due outbox entry through its original transport. Never throws. */
async function processEntry(entry: OutboxEntry): Promise<void> {
    // Broadcast fan-out deliveries share the outbox table for persistence but
    // are scheduled by `services/broadcastService.ts`, not by this worker. They
    // must never be claimed here or the two schedulers would race on the row.
    if (entry.event === BROADCAST_EVENT || entry.channel.startsWith(BROADCAST_CHANNEL_PREFIX)) {
        return;
    }

    let payload: NotifyPayload;
    try {
        payload = JSON.parse(entry.payload) as NotifyPayload;
    } catch {
        await markOutboxFailed(entry.id, entry.maxAttempts, entry.maxAttempts, 'invalid payload JSON');
        return;
    }

    // Validate persisted discriminators before dispatch: a corrupt or tampered
    // row must terminally fail instead of flowing into a transport unchecked.
    if (
        !(NOTIFY_EVENTS as readonly string[]).includes(entry.event) ||
        !(NOTIFY_SEVERITIES as readonly string[]).includes(entry.severity) ||
        !VALID_CHANNELS.includes(entry.channel) ||
        typeof payload !== 'object' ||
        payload === null ||
        typeof (payload as NotifyPayload).summary !== 'string'
    ) {
        await markOutboxFailed(entry.id, entry.maxAttempts, entry.maxAttempts, 'invalid persisted outbox row');
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

/** Stops the cron-driven outbox retry worker. */
export function stopOutboxWorker(): void {
    if (task) {
        task.stop();
        task = null;
    }
}
