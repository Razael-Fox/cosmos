/**
 * Batched operational issue-log forwarding.
 *
 * Runtime errors are accumulated for a fixed window, deduplicated by a
 * normalized signature, and capped so a crash loop cannot flood the external
 * channels. A cron worker flushes the buffer as a single `ISSUE_LOG` event.
 *
 * The buffer intentionally lives in memory only: issue logs are ephemeral
 * telemetry, and losing a batch on process death is acceptable (the
 * uncaughtException path flushes synchronously before exiting).
 */
import cron from 'node-cron';
import { buildIssueDetails } from './formatters.js';
import { notify } from './notifier.js';
import type { NotifySeverity } from './types.js';

interface IssueEntry {
    signature: string;
    summary: string;
    location?: string;
    sessionId?: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10;

const buffer = new Map<string, IssueEntry>();
let flushSchedule: ReturnType<typeof cron.schedule> | null = null;

/** Normalizes an error summary into a low-cardinality dedupe signature. */
function normalizeSignature(text: string): string {
    return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Records an error for batched forwarding. Never throws. */
export function recordIssue(error: unknown, context: { sessionId?: string; severity?: NotifySeverity } = {}): void {
    try {
        const { summary, location } = buildIssueDetails(error);
        const signature = normalizeSignature(`${summary} ${location ?? ''}`);
        const now = Date.now();
        const existing = buffer.get(signature);
        if (existing) {
            existing.count += 1;
            existing.lastSeen = now;
            return;
        }
        if (buffer.size >= MAX_ENTRIES) return;
        buffer.set(signature, {
            signature,
            summary,
            location,
            sessionId: context.sessionId,
            count: 1,
            firstSeen: now,
            lastSeen: now
        });
    } catch (err) {
        console.error('[StatusNotifier] Failed to record issue:', err);
    }
}

/** Flushes the buffered issues as a single notification. Never throws. */
export async function flushIssues(force = false): Promise<void> {
    if (buffer.size === 0) return;
    const now = Date.now();
    const due: IssueEntry[] = [];
    const pending = new Map<string, IssueEntry>();

    for (const [signature, entry] of buffer.entries()) {
        if (force || now - entry.firstSeen >= WINDOW_MS) {
            due.push(entry);
        } else {
            pending.set(signature, entry);
        }
    }
    buffer.clear();
    for (const [signature, entry] of pending.entries()) buffer.set(signature, entry);
    if (due.length === 0) return;

    const hasCritical = due.some((entry) => entry.count >= 3);
    const severity: NotifySeverity = hasCritical ? 'CRITICAL' : 'WARN';

    const details = due.map((entry) => {
        const first = new Date(entry.firstSeen).toISOString();
        const last = new Date(entry.lastSeen).toISOString();
        const location = entry.location ? ` @ ${entry.location}` : '';
        return `[x${entry.count}] ${entry.summary}${location} (first ${first}, last ${last})`;
    });

    await notify(
        'ISSUE_LOG',
        severity,
        {
            summary: `${due.length} distinct issue(s) in the last window.`,
            details,
            sessionId: due[0]?.sessionId
        },
        { dedupeKey: `ISSUE_LOG:${normalizeSignature(details.join('|'))}` }
    );
}

/** Starts the periodic flush worker (every 5 minutes). */
export function startIssueLogger(): void {
    if (flushSchedule) return;
    flushSchedule = cron.schedule('*/5 * * * *', () => {
        void flushIssues();
    });
    console.log('[StatusNotifier] Issue-log forwarding worker started (every 5 minutes).');
}

/** Stops the periodic issue-log flush worker. */
export function stopIssueLogger(): void {
    if (flushSchedule) {
        flushSchedule.stop();
        flushSchedule = null;
    }
}
