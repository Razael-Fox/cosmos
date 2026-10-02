/**
 * Persisted broadcast fan-out service.
 *
 * Replaces the fire-and-forget in-memory loop that previously backed
 * `case '/internal/broadcast'` in `src/services/ipcServer.ts`. The motivating
 * request from issue #49 — "broadcast to all groups with a 5-second delay per
 * group" — can span hours, so the schedule must survive a restart
 * (AGENTS.md Rule J: no in-memory `setTimeout` for a long fan-out).
 *
 * Persistence reuses the existing status-notification tables rather than
 * introducing a new schema, which keeps the Rule W dual-maintenance burden
 * unchanged:
 *   - `StatusNotificationLog`   -> one row per broadcast JOB.
 *   - `StatusNotificationOutbox`-> one row per delivery TARGET, with
 *     `nextAttemptAt` encoding the staggered send schedule.
 *
 * The rows are marked with `event = 'BROADCAST'` and a `broadcast:` channel
 * prefix; `statusNotifier/outboxWorker.ts` explicitly skips them so the two
 * schedulers never contend for the same row.
 */
import crypto from 'crypto';
import cron from 'node-cron';
import { prisma } from '#db.js';
import { activeConnections } from '#utils/connectionManager.js';
import { registerCancellableSession, unregisterCancellableSession } from '#utils/cancellationManager.js';
import type { WASocket } from '@whiskeysockets/baileys';

/** `StatusNotificationLog.event` / `StatusNotificationOutbox.event` discriminator. */
export const BROADCAST_EVENT = 'BROADCAST';
/** `StatusNotificationOutbox.channel` prefix; deliberately outside the notifier's channel list. */
export const BROADCAST_CHANNEL_PREFIX = 'broadcast:';
/** `cancellationManager` feature name registered for a running broadcast. */
export const BROADCAST_CANCELLABLE_FEATURE = 'broadcast';

export type BroadcastJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type BroadcastTargetSource = 'explicit' | 'participating' | 'whitelist';

export interface BroadcastTargetResolution {
    targets: string[];
    source: BroadcastTargetSource;
    /** Formal English explanation of how the target list was resolved. */
    note: string;
}

export interface BroadcastPreview {
    targetCount: number;
    /** Masked targets, e.g. `120363•••••1234@g.us`. */
    maskedTargets: string[];
    /** Server-side ephemeral aliases the caller can echo back. */
    targetRefs: string[];
    source: BroadcastTargetSource;
    delayMs: number;
    /** Wall-clock time the fan-out is expected to take. */
    estimatedDurationMs: number;
    messageLength: number;
    /** Formal English explanation of how the target list was resolved. */
    note: string;
}

export interface BroadcastStartResult {
    jobId: string;
    queued: number;
    source: BroadcastTargetSource;
    delayMs: number;
    estimatedDurationMs: number;
    /** Per-target receipts produced synchronously during this call. */
    receipts: BroadcastReceipt[];
}

export interface BroadcastReceipt {
    target: string;
    status: 'SENT' | 'FAILED' | 'PENDING' | 'CANCELLED';
    attempts: number;
    error?: string | null;
    deliveredAt?: string | null;
}

export interface BroadcastJobStatusReport {
    jobId: string;
    status: BroadcastJobStatus;
    message: string;
    delayMs: number;
    targetCount: number;
    createdAt: string | null;
    counts: { sent: number; failed: number; pending: number; cancelled: number };
    receipts: BroadcastReceipt[];
}

interface BroadcastDeliveryPayload {
    jobId: string;
    jid: string;
    message: string;
}

function maskGroupJid(jid: string): string {
    const at = jid.indexOf('@');
    const domain = at === -1 ? '' : jid.slice(at);
    const local = at === -1 ? jid : jid.slice(0, at);
    if (local.length <= 9) return `${local}${domain}`;
    return `${local.slice(0, 6)}${'•'.repeat(Math.max(1, local.length - 9))}${local.slice(-3)}${domain}`;
}

function getSocket(): WASocket | null {
    return (activeConnections.get('default') as WASocket | undefined) ?? null;
}

/**
 * Resolves the broadcast target list.
 *
 * Precedence: an explicit JID list, then every participating group discovered
 * from the live socket, then the `WhitelistedGroup` database fallback.
 */
export async function resolveBroadcastTargets(explicit?: string[]): Promise<BroadcastTargetResolution> {
    if (explicit && explicit.length > 0) {
        const normalised = explicit
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0 && entry.endsWith('@g.us'));
        if (normalised.length === 0) {
            return {
                targets: [],
                source: 'explicit',
                note: 'No valid WhatsApp group JID was supplied in targetGroups.'
            };
        }
        return {
            targets: [...new Set(normalised)],
            source: 'explicit',
            note: 'Target list supplied explicitly by the caller.'
        };
    }

    const sock = getSocket();
    if (sock) {
        try {
            const participating = await sock.groupFetchAllParticipating();
            const ids = Object.keys(participating).filter((id) => id.endsWith('@g.us'));
            if (ids.length > 0) {
                return {
                    targets: ids,
                    source: 'participating',
                    note: 'Target list resolved from every group the default session is participating in.'
                };
            }
        } catch (err) {
            console.warn('[Broadcast] Failed to fetch participating groups, falling back to the database:', err);
        }
    }

    try {
        const whitelisted = await prisma.whitelistedGroup.findMany({ select: { jid: true } });
        const ids = whitelisted.map((group) => group.jid).filter((jid) => jid.endsWith('@g.us'));
        return {
            targets: ids,
            source: 'whitelist',
            note: 'Target list resolved from the WhitelistedGroup database fallback.'
        };
    } catch (err) {
        console.error('[Broadcast] Failed to query the WhitelistedGroup fallback:', err);
        return { targets: [], source: 'whitelist', note: 'The WhitelistedGroup fallback could not be read.' };
    }
}

/** Resolves the target list and reports the plan WITHOUT sending anything. */
export async function previewBroadcast(options: {
    message: string;
    delayMs: number;
    targetGroups?: string[];
}): Promise<BroadcastPreview> {
    const resolution = await resolveBroadcastTargets(options.targetGroups);
    return {
        targetCount: resolution.targets.length,
        maskedTargets: resolution.targets.map(maskGroupJid),
        targetRefs: resolution.targets,
        source: resolution.source,
        delayMs: options.delayMs,
        estimatedDurationMs: resolution.targets.length > 1 ? (resolution.targets.length - 1) * options.delayMs : 0,
        messageLength: options.message.length,
        note: resolution.note
    };
}

/**
 * Persists a broadcast job plus one scheduled delivery row per target and kicks
 * the scheduler. Returns immediately; the caller receives a job id it can poll.
 */
export async function startBroadcast(options: {
    message: string;
    delayMs: number;
    targetGroups?: string[];
    requestedBy: string;
}): Promise<BroadcastStartResult> {
    const resolution = await resolveBroadcastTargets(options.targetGroups);
    if (resolution.targets.length === 0) {
        throw new Error('NO_GROUPS_FOUND');
    }

    const jobId = `bcast_${crypto.randomUUID()}`;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
        await tx.statusNotificationLog.create({
            data: {
                event: BROADCAST_EVENT,
                severity: 'INFO',
                summary: options.message.slice(0, 400),
                status: 'QUEUED',
                channels: JSON.stringify({ jobId, delayMs: options.delayMs, targetCount: resolution.targets.length }),
                version: null
            }
        });

        const rows = resolution.targets.map((jid, index) => ({
            event: BROADCAST_EVENT,
            severity: 'INFO',
            channel: `${BROADCAST_CHANNEL_PREFIX}${jid}`,
            payload: JSON.stringify({ jobId, jid, message: options.message } satisfies BroadcastDeliveryPayload),
            status: 'PENDING',
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            nextAttemptAt: new Date(now.getTime() + index * options.delayMs)
        }));

        // Chunked so a large fan-out never exceeds SQLite's bound-variable limit.
        for (let offset = 0; offset < rows.length; offset += 200) {
            await tx.statusNotificationOutbox.createMany({ data: rows.slice(offset, offset + 200) });
        }
    });

    console.log(
        `[Broadcast] Job ${jobId} queued for ${resolution.targets.length} group(s) with a ${options.delayMs} ms inter-group delay (source=${resolution.source}).`
    );

    registerCancellableSession({
        sessionId: jobId,
        feature: BROADCAST_CANCELLABLE_FEATURE,
        userJid: options.requestedBy,
        chatJid: options.requestedBy,
        description: `broadcast to ${resolution.targets.length} group(s)`,
        onCancel: async () => {
            const cancelled = await cancelBroadcast(jobId);
            return cancelled
                ? 'The scheduled broadcast has been cancelled. Remaining groups will not be contacted.'
                : 'The broadcast could not be cancelled because it had already finished.';
        }
    });

    void processBroadcastBatch();

    return {
        jobId,
        queued: resolution.targets.length,
        source: resolution.source,
        delayMs: options.delayMs,
        estimatedDurationMs: (resolution.targets.length - 1) * options.delayMs,
        receipts: resolution.targets.map((jid) => ({
            target: maskGroupJid(jid),
            status: 'PENDING' as const,
            attempts: 0
        }))
    };
}

/** Cancels every still-pending delivery of a job. Returns true when anything changed. */
export async function cancelBroadcast(jobId: string): Promise<boolean> {
    const result = await prisma.statusNotificationOutbox.updateMany({
        where: { event: BROADCAST_EVENT, status: 'PENDING', payload: { contains: `"jobId":"${jobId}"` } },
        data: { status: 'CANCELLED' }
    });
    await markJobStatus(jobId, 'CANCELLED');
    unregisterCancellableSession(jobId);
    console.log(`[Broadcast] Job ${jobId} cancelled; ${result.count} pending delivery row(s) released.`);
    return result.count > 0;
}

/** Aggregates a job's delivery receipts from the persistent outbox. */
export async function getBroadcastStatus(jobId: string): Promise<BroadcastJobStatusReport | null> {
    const rows = await prisma.statusNotificationOutbox.findMany({
        where: { event: BROADCAST_EVENT, payload: { contains: `"jobId":"${jobId}"` } },
        orderBy: { createdAt: 'asc' },
        take: 500
    });

    if (rows.length === 0) return null;

    const counts = { sent: 0, failed: 0, pending: 0, cancelled: 0 };
    const receipts: BroadcastReceipt[] = [];
    let message = '';
    let jobStatus: BroadcastJobStatus = 'QUEUED';
    let earliestCreatedAt: Date | null = null;

    for (const row of rows) {
        let jid = row.channel.slice(BROADCAST_CHANNEL_PREFIX.length);
        try {
            const payload = JSON.parse(row.payload) as BroadcastDeliveryPayload;
            jid = payload.jid || jid;
            message = payload.message || message;
        } catch {
            /* keep the channel-derived JID */
        }
        if (earliestCreatedAt === null) earliestCreatedAt = row.createdAt;

        const status: BroadcastReceipt['status'] =
            row.status === 'SENT'
                ? 'SENT'
                : row.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : row.status === 'FAILED'
                    ? 'FAILED'
                    : 'PENDING';
        counts[
            status === 'SENT'
                ? 'sent'
                : status === 'FAILED'
                  ? 'failed'
                  : status === 'CANCELLED'
                    ? 'cancelled'
                    : 'pending'
        ] += 1;
        receipts.push({
            target: maskGroupJid(jid),
            status,
            attempts: row.attempts,
            error: row.lastError,
            deliveredAt: row.status === 'SENT' ? row.updatedAt.toISOString() : null
        });
    }

    if (counts.pending === 0) {
        jobStatus =
            counts.cancelled > 0 && counts.sent === 0 ? 'CANCELLED' : counts.failed > 0 ? 'FAILED' : 'COMPLETED';
    } else if (counts.sent > 0 || counts.failed > 0) {
        jobStatus = 'RUNNING';
    }

    return {
        jobId,
        status: jobStatus,
        message,
        delayMs: 0,
        targetCount: rows.length,
        createdAt: earliestCreatedAt ? earliestCreatedAt.toISOString() : null,
        counts,
        receipts
    };
}

/** Lists recent broadcast jobs, newest first. */
export async function listBroadcastJobs(
    limit = 10
): Promise<Array<{ jobId: string; status: string; summary: string; createdAt: string | null }>> {
    const rows = await prisma.statusNotificationLog.findMany({
        where: { event: BROADCAST_EVENT },
        orderBy: { createdAt: 'desc' },
        take: Math.min(50, Math.max(1, limit))
    });
    return rows.map((row) => {
        let jobId = 'unknown';
        let delayMs = 0;
        let targetCount = 0;
        try {
            const parsed = JSON.parse(row.channels || '{}') as {
                jobId?: string;
                delayMs?: number;
                targetCount?: number;
            };
            jobId = parsed.jobId ?? 'unknown';
            delayMs = parsed.delayMs ?? 0;
            targetCount = parsed.targetCount ?? 0;
        } catch {
            /* channels is advisory metadata */
        }
        return {
            jobId,
            status: row.status,
            summary: `${row.summary.slice(0, 80)} (delayMs=${delayMs}, targets=${targetCount})`,
            createdAt: row.createdAt.toISOString()
        };
    });
}

/** Marks the job row terminal when no pending deliveries remain. */
async function markJobStatus(jobId: string, status: BroadcastJobStatus): Promise<void> {
    try {
        const jobRows = await prisma.statusNotificationLog.findMany({
            where: { event: BROADCAST_EVENT, channels: { contains: jobId } },
            select: { id: true },
            take: 1
        });
        const jobRow = jobRows[0];
        if (!jobRow) return;
        await prisma.statusNotificationLog.update({ where: { id: jobRow.id }, data: { status } });
    } catch (err) {
        console.error(`[Broadcast] Failed to mark job ${jobId} as ${status}:`, err);
    }
}

let running = false;

/**
 * Delivers every due broadcast row. Because the send schedule lives in
 * `nextAttemptAt`, a restart mid-fan-out resumes exactly where it stopped.
 */
export async function processBroadcastBatch(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const sock = getSocket();
        const due = await prisma.statusNotificationOutbox.findMany({
            where: { event: BROADCAST_EVENT, status: 'PENDING', nextAttemptAt: { lte: new Date() } },
            orderBy: { nextAttemptAt: 'asc' },
            take: 20
        });

        if (due.length === 0) return;

        if (!sock) {
            console.warn('[Broadcast] The default session is offline; deferring due deliveries.');
            return;
        }

        for (const row of due) {
            let payload: BroadcastDeliveryPayload;
            try {
                payload = JSON.parse(row.payload) as BroadcastDeliveryPayload;
            } catch {
                await prisma.statusNotificationOutbox.update({
                    where: { id: row.id },
                    data: { status: 'FAILED', lastError: 'invalid payload JSON' }
                });
                continue;
            }

            try {
                await sock.sendMessage(payload.jid, { text: payload.message });
                await prisma.statusNotificationOutbox.update({
                    where: { id: row.id },
                    data: { status: 'SENT', attempts: row.attempts + 1, lastError: null }
                });
                console.log(`[Broadcast] Delivered job ${payload.jobId} to ${maskGroupJid(payload.jid)}.`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const attempts = row.attempts + 1;
                const exhausted = attempts >= (row.maxAttempts ?? 3);
                // Re-schedule with the same stagger so the fan-out pace holds.
                const nextAttemptAt = new Date(Date.now() + (exhausted ? 60_000 : 15_000));
                await prisma.statusNotificationOutbox.update({
                    where: { id: row.id },
                    data: {
                        attempts,
                        lastError: message.slice(0, 500),
                        status: exhausted ? 'FAILED' : 'PENDING',
                        nextAttemptAt
                    }
                });
                console.error(
                    `[Broadcast] Delivery to ${maskGroupJid(payload.jid)} failed (attempt ${attempts}): ${message}`
                );
            }
        }

        await reconcileJobStatuses(due.map((row) => row.id));
    } catch (err) {
        console.error('[Broadcast] Batch processing failed:', err);
    } finally {
        running = false;
    }
}

/** Closes out every job whose deliveries are all terminal. */
async function reconcileJobStatuses(rowIds: string[]): Promise<void> {
    const jobIds = new Set<string>();
    const rows = await prisma.statusNotificationOutbox.findMany({
        where: { id: { in: rowIds } },
        select: { payload: true }
    });
    for (const row of rows) {
        try {
            jobIds.add((JSON.parse(row.payload) as BroadcastDeliveryPayload).jobId);
        } catch {
            /* ignore malformed rows */
        }
    }

    for (const jobId of jobIds) {
        const remaining = await prisma.statusNotificationOutbox.count({
            where: { event: BROADCAST_EVENT, status: 'PENDING', payload: { contains: `"jobId":"${jobId}"` } }
        });
        if (remaining > 0) {
            await markJobStatus(jobId, 'RUNNING');
            continue;
        }
        const failed = await prisma.statusNotificationOutbox.count({
            where: { event: BROADCAST_EVENT, status: 'FAILED', payload: { contains: `"jobId":"${jobId}"` } }
        });
        const sent = await prisma.statusNotificationOutbox.count({
            where: { event: BROADCAST_EVENT, status: 'SENT', payload: { contains: `"jobId":"${jobId}"` } }
        });
        const cancelled = await prisma.statusNotificationOutbox.count({
            where: { event: BROADCAST_EVENT, status: 'CANCELLED', payload: { contains: `"jobId":"${jobId}"` } }
        });
        const status: BroadcastJobStatus =
            sent === 0 && cancelled > 0 ? 'CANCELLED' : failed > 0 ? 'FAILED' : 'COMPLETED';
        await markJobStatus(jobId, status);
        unregisterCancellableSession(jobId);
        console.log(
            `[Broadcast] Job ${jobId} finished with status ${status} (sent=${sent}, failed=${failed}, cancelled=${cancelled}).`
        );
    }
}

let task: ReturnType<typeof cron.schedule> | null = null;

/** Starts the cron-driven broadcast scheduler. Safe to call repeatedly. */
export function startBroadcastWorker(): void {
    if (task) return;
    task = cron.schedule('* * * * *', () => {
        void processBroadcastBatch();
    });
    console.log('[Broadcast] Persistent broadcast worker started (cron "* * * * *").');
}

/** Stops the broadcast scheduler. */
export function stopBroadcastWorker(): void {
    if (task) {
        task.stop();
        task = null;
    }
}
