/**
 * Database integrity guard.
 *
 * Runs at startup and then hourly. Detects a missing, zero-byte, or structurally
 * corrupt SQLite file and emits `DB_MISSING` / `DB_CORRUPT` CRITICAL alerts.
 * Detection is performed with better-sqlite3 directly so it still works when
 * Prisma itself is unable to open the database.
 */
import fs from 'fs';
import cron from 'node-cron';
import { notify } from './notifier.js';
import { recordIssue, flushIssues } from './issueLogger.js';
import { resolveStatusDatabasePath } from './dbPath.js';

const CHECK_CRON = '0 * * * *'; // hourly
let task: ReturnType<typeof cron.schedule> | null = null;

/**
 * Last integrity verdict produced by the hourly guard. The lightweight
 * 60-second health heartbeat reuses this value instead of re-running
 * `PRAGMA integrity_check` and hashing the whole database every minute.
 */
let lastIntegrity: 'ok' | 'missing' | 'failed' | 'unknown' = 'unknown';

/** Returns the most recent database integrity verdict from the hourly guard. */
export function getLastDbIntegrity(): 'ok' | 'missing' | 'failed' | 'unknown' {
    return lastIntegrity;
}

export type DbGuardStatus = 'ok' | 'missing' | 'zero-byte' | 'corrupt';

export interface DbGuardResult {
    status: DbGuardStatus;
    dbPath: string;
    detail?: string;
    sizeBytes?: number;
}

/**
 * Inspects the SQLite file. Uses better-sqlite3 directly for `integrity_check`
 * so corruption is still detectable when Prisma cannot connect.
 */
export async function inspectDatabase(): Promise<DbGuardResult> {
    const dbPath = resolveStatusDatabasePath();

    if (!fs.existsSync(dbPath)) {
        return { status: 'missing', dbPath };
    }

    const size = fs.statSync(dbPath).size;
    if (size === 0) {
        return { status: 'zero-byte', dbPath, sizeBytes: 0 };
    }

    try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
            const rows = db.pragma('integrity_check') as Array<{ integrity_check?: string }>;
            const verdict = rows?.[0]?.integrity_check ?? 'unknown';
            if (verdict.toLowerCase() !== 'ok') {
                return { status: 'corrupt', dbPath, detail: verdict, sizeBytes: size };
            }
        } finally {
            db.close();
        }
    } catch (err) {
        return {
            status: 'corrupt',
            dbPath,
            detail: err instanceof Error ? err.message : String(err),
            sizeBytes: size
        };
    }

    return { status: 'ok', dbPath, sizeBytes: size };
}

/**
 * Runs the guard, dispatching alerts and attempting an emergency backup when a
 * problem is found. Never throws.
 */
export async function runDatabaseGuard(options: { startup?: boolean } = {}): Promise<DbGuardResult> {
    let result: DbGuardResult;
    try {
        result = await inspectDatabase();
    } catch (err) {
        console.error('[DbGuard] Failed to inspect database:', err);
        lastIntegrity = 'failed';
        return { status: 'corrupt', dbPath: resolveStatusDatabasePath(), detail: 'inspection error' };
    }

    lastIntegrity =
        result.status === 'ok'
            ? 'ok'
            : result.status === 'missing' || result.status === 'zero-byte'
              ? 'missing'
              : 'failed';

    if (result.status === 'ok') {
        if (options.startup) {
            console.log(`[DbGuard] Database integrity OK (${result.sizeBytes ?? 0} bytes).`);
        }
        return result;
    }

    const isMissing = result.status === 'missing' || result.status === 'zero-byte';
    const event = isMissing ? 'DB_MISSING' : 'DB_CORRUPT';
    const summary = isMissing
        ? `The SQLite database file is ${result.status} and could not be opened.`
        : 'The SQLite database failed its integrity check.';

    console.error(`[DbGuard] ${event}: ${summary}`);

    await notify(
        event,
        'CRITICAL',
        {
            summary,
            details: result.detail ? [result.detail] : undefined,
            fields: {
                Status: result.status,
                Size: result.sizeBytes !== undefined ? `${result.sizeBytes} bytes` : 'n/a'
            },
            sessionId: 'default'
        },
        { dedupeKey: `${event}:${result.status}`, dedupeWindowMs: 30 * 60 * 1000 }
    );

    // Attempt an emergency backup so the last-known-good state is preserved
    // (or the failure is surfaced with the reason).
    try {
        const { sendBackupToTelegram, dispatchBackupStatus } = await import('#lib/backup.js');
        const backupOk = await sendBackupToTelegram({ force: true });
        if (!backupOk) {
            await dispatchBackupStatus(
                false,
                null,
                'Emergency backup after database integrity failure was not persisted.'
            );
        }
    } catch (err) {
        console.error('[DbGuard] Emergency backup attempt failed:', err);
        recordIssue(err, { sessionId: 'default' });
        await flushIssues(true);
    }

    return result;
}

/** Starts the startup + hourly database integrity guard. */
export function startDbGuard(): void {
    if (task) return;
    // Startup check (non-blocking).
    void runDatabaseGuard({ startup: true });
    task = cron.schedule(CHECK_CRON, () => {
        void runDatabaseGuard();
    });
    console.log('[StatusNotifier] Database guard started (startup + hourly).');
}

/** Stops the startup + hourly database integrity guard. */
export function stopDbGuard(): void {
    if (task) {
        task.stop();
        task = null;
    }
}
