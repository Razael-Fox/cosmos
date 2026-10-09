/**
 * External Status Notification subsystem — persistent outbox.
 *
 * Prisma-backed queue (Rule J: no in-memory setTimeout). Failed deliveries are
 * enqueued here and retried by a cron-driven worker. The outbox is best-effort:
 * if the database itself is unavailable the enqueue silently no-ops rather than
 * throwing into the caller (e.g. the Baileys socket loop).
 */
import { prisma } from '#db.js';
import { getStatusNotifierConfig } from './config.js';
import type { NotifyChannel, NotifyEvent, NotifyPayload, NotifySeverity } from './types.js';

export interface OutboxEntry {
    id: string;
    event: string;
    severity: string;
    channel: string;
    payload: string;
    attempts: number;
    maxAttempts: number;
}

/** Persists a failed delivery for later retry. Never throws. */
export async function enqueueOutbox(
    event: NotifyEvent,
    severity: NotifySeverity,
    channel: NotifyChannel,
    payload: NotifyPayload,
    error?: string
): Promise<void> {
    try {
        const config = getStatusNotifierConfig();
        await prisma.statusNotificationOutbox.create({
            data: {
                event,
                severity,
                channel,
                payload: JSON.stringify(payload),
                // The initial fan-out delivery already counts as attempt 1,
                // so the worker's maxAttempts budget includes it.
                attempts: 1,
                maxAttempts: config.maxAttempts,
                status: 'PENDING',
                lastError: error ? error.slice(0, 500) : null,
                nextAttemptAt: new Date(Date.now() + 60_000)
            }
        });
    } catch (err) {
        console.error('[StatusNotifier] Failed to enqueue outbox entry:', err);
    }
}

/** Claims a batch of due outbox entries. Never throws. */
export async function claimDueOutbox(limit = 20): Promise<OutboxEntry[]> {
    try {
        return (await prisma.statusNotificationOutbox.findMany({
            where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
            orderBy: { nextAttemptAt: 'asc' },
            take: limit
        })) as OutboxEntry[];
    } catch (err) {
        console.error('[StatusNotifier] Failed to read outbox entries:', err);
        return [];
    }
}

/** Marks an outbox entry as sent. Never throws. */
export async function markOutboxSent(id: string): Promise<void> {
    try {
        await prisma.statusNotificationOutbox.update({ where: { id }, data: { status: 'SENT' } });
    } catch (err) {
        console.error('[StatusNotifier] Failed to mark outbox entry sent:', err);
    }
}

/** Records a failed retry attempt, rescheduling or marking as failed. Never throws. */
export async function markOutboxFailed(
    id: string,
    attempts: number,
    maxAttempts: number,
    error?: string
): Promise<void> {
    try {
        const nextStatus = attempts >= maxAttempts ? 'FAILED' : 'PENDING';
        const delayMs = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
        await prisma.statusNotificationOutbox.update({
            where: { id },
            data: {
                attempts,
                status: nextStatus,
                lastError: error ? error.slice(0, 500) : null,
                nextAttemptAt: new Date(Date.now() + delayMs)
            }
        });
    } catch (err) {
        console.error('[StatusNotifier] Failed to record outbox failure:', err);
    }
}

/** Prunes terminal outbox rows older than 7 days. Never throws. */
export async function pruneOutbox(): Promise<void> {
    try {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await prisma.statusNotificationOutbox.deleteMany({
            where: { status: { in: ['SENT', 'FAILED'] }, updatedAt: { lt: cutoff } }
        });
    } catch (err) {
        console.error('[StatusNotifier] Failed to prune outbox:', err);
    }
}
