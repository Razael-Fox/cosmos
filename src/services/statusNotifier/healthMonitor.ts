/**
 * Health and integrity monitor.
 *
 * Emits a heartbeat every 60 seconds and translates the observed state into
 * `STATUS_DEGRADED`, `BOT_DOWN`, and `BOT_RECONNECTED` events. Dedupe is applied
 * at the notifier layer so a single incident alerts exactly once.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { activeConnections } from '#utils/connectionManager.js';
import { prisma } from '#db.js';
import { notify } from './notifier.js';

const HEARTBEAT_CRON = '* * * * *'; // every minute
const RSS_WARN_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const HEAP_WARN_RATIO = 0.9;

let heartbeats = 0;
let botDownAlerted = false;
let task: ReturnType<typeof cron.schedule> | null = null;

// Suppress BOT_DOWN during the initial startup window while the default session
// is still pairing/connecting, to avoid a false-positive outage alert.
const STARTUP_GRACE_MS = 5 * 60 * 1000;
let startedAt = 0;

function resolveDatabasePath(): string {
    const raw = process.env.DATABASE_URL?.replace('file:', '') || './storage/database.sqlite';
    if (raw.startsWith('/app/storage') && !fs.existsSync('/app')) {
        return path.resolve(process.cwd(), 'storage', 'database.sqlite');
    }
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

/** Runs `PRAGMA integrity_check` directly through better-sqlite3. */
async function runIntegrityCheck(dbPath: string): Promise<string> {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const rows = db.pragma('integrity_check') as Array<{ integrity_check?: string }>;
        return rows?.[0]?.integrity_check ?? 'unknown';
    } finally {
        db.close();
    }
}

interface HealthSnapshot {
    healthy: boolean;
    degradedReasons: string[];
    botDown: boolean;
    integrity: 'ok' | 'missing' | 'failed';
    prismaOk: boolean;
    dbExists: boolean;
    dbHash?: string;
}

/** Collects a sanitized health snapshot. Never throws. */
export async function collectHealth(): Promise<HealthSnapshot> {
    const reasons: string[] = [];
    const dbPath = resolveDatabasePath();

    const dbExists = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
    if (!dbExists) reasons.push('database file missing or zero-byte');

    let integrity: 'ok' | 'missing' | 'failed' = 'ok';
    let dbHash: string | undefined;
    if (dbExists) {
        try {
            const result = await runIntegrityCheck(dbPath);
            if (result.toLowerCase() !== 'ok') {
                integrity = 'failed';
                reasons.push(`integrity_check reported: ${result}`);
            }
            // Lightweight fingerprint for post-mortem correlation only.
            const { computeFileHash } = await import('#utils/backup.js');
            dbHash = (await computeFileHash(dbPath)).slice(0, 12);
        } catch (err) {
            integrity = 'failed';
            reasons.push(`integrity probe failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else {
        integrity = 'missing';
    }

    let prismaOk = true;
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch {
        prismaOk = false;
        reasons.push('Prisma probe failed');
    }

    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? memory.heapUsed / memory.heapTotal : 0;
    if (memory.rss > RSS_WARN_BYTES) reasons.push(`RSS high (${(memory.rss / 1024 / 1024).toFixed(0)} MB)`);
    if (heapRatio > HEAP_WARN_RATIO) reasons.push(`heap usage high (${(heapRatio * 100).toFixed(0)}%)`);

    const botDown = activeConnections.size === 0;
    if (botDown) reasons.push('no active WhatsApp connection');

    return {
        healthy: reasons.length === 0,
        degradedReasons: reasons,
        botDown,
        integrity,
        prismaOk,
        dbExists,
        dbHash
    };
}

async function heartbeat(): Promise<void> {
    heartbeats++;
    let snapshot: HealthSnapshot;
    try {
        snapshot = await collectHealth();
    } catch (err) {
        console.error('[HealthMonitor] Failed to collect health snapshot:', err);
        return;
    }

    if (snapshot.botDown) {
        // Do not fire the bot-down incident during the initial connection grace window.
        if (Date.now() - startedAt < STARTUP_GRACE_MS) {
            return;
        }
        if (!botDownAlerted) {
            botDownAlerted = true;
            await notify(
                'BOT_DOWN',
                'CRITICAL',
                {
                    summary: 'No active WhatsApp connection was detected during the health heartbeat.',
                    details: snapshot.degradedReasons,
                    sessionId: 'default'
                },
                { dedupeKey: 'BOT_DOWN:default', dedupeWindowMs: 60 * 60 * 1000 }
            );
        }
        return;
    }

    // The bot is connected again: clear the incident flag and emit one recovery.
    if (botDownAlerted) {
        botDownAlerted = false;
        await notify(
            'BOT_RECONNECTED',
            'INFO',
            {
                summary: 'A WhatsApp connection is active again.',
                sessionId: 'default'
            },
            { dedupeKey: 'BOT_RECONNECTED:default', dedupeWindowMs: 60 * 1000, force: true }
        );
    }

    if (!snapshot.healthy) {
        await notify(
            'STATUS_DEGRADED',
            'WARN',
            {
                summary: 'Health heartbeat reported one or more degraded conditions.',
                details: snapshot.degradedReasons,
                fields: {
                    Database: snapshot.integrity,
                    Prisma: snapshot.prismaOk ? 'ok' : 'failed',
                    Uptime: `${process.uptime().toFixed(0)}s`,
                    RSS: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`,
                    Load: os.loadavg()[0]?.toFixed(2) ?? 'n/a'
                }
            },
            {
                dedupeKey: `STATUS_DEGRADED:${snapshot.degradedReasons.join('|')}`,
                dedupeWindowMs: 30 * 60 * 1000
            }
        );
    }
}

/** Starts the 60-second health heartbeat. */
export function startHealthMonitor(): void {
    if (task) return;
    startedAt = Date.now();
    // Fire one heartbeat shortly after startup, then every minute.
    void heartbeat();
    task = cron.schedule(HEARTBEAT_CRON, () => {
        void heartbeat();
    });
    console.log('[StatusNotifier] Health monitor started (60s heartbeat).');
}

export function stopHealthMonitor(): void {
    if (task) {
        task.stop();
        task = null;
    }
}

/** Test/inspection helper. */
export function getHeartbeatCount(): number {
    return heartbeats;
}

/** Test helper: resets the in-memory incident flag. */
export function resetBotDownFlag(): void {
    botDownAlerted = false;
}
