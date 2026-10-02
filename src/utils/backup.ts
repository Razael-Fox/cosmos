import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import cron from 'node-cron';
import { resolveStatusDatabasePath } from '../services/statusNotifier/dbPath.js';

const BACKUP_HASH_FILENAME = '.telegram-backup-hash';

let backupInFlight = false;
let autoBackupStarted = false;

/** Returns the absolute path of the SQLite database file under backup. */
function getDatabasePath(): string {
    return resolveStatusDatabasePath();
}

function getHashFilePath(): string {
    return path.join(path.dirname(getDatabasePath()), BACKUP_HASH_FILENAME);
}

/**
 * Computes the SHA-256 hex digest of a file using a read stream,
 * so arbitrarily large database files never fully load into memory.
 */
export function computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/** Reads the SHA-256 digest recorded by the last successful Telegram backup, if any. */
export function readLastBackupHash(): string | null {
    try {
        const hashPath = getHashFilePath();
        if (!fs.existsSync(hashPath)) return null;
        const stored = fs.readFileSync(hashPath, 'utf8').trim();
        return /^[a-f0-9]{64}$/.test(stored) ? stored : null;
    } catch (err) {
        console.error('[Backup] Failed to read last backup hash:', err);
        return null;
    }
}

function writeLastBackupHash(hash: string): void {
    try {
        fs.writeFileSync(getHashFilePath(), `${hash}\n`, 'utf8');
    } catch (err) {
        console.error('[Backup] Failed to persist backup hash:', err);
    }
}

/** Returns true when Telegram backup credentials are configured. */
function isTelegramConfigured(): boolean {
    return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Uploads the SQLite snapshot to Telegram. Returns true only when a fresh
 * snapshot was delivered; false when Telegram is unconfigured, the database
 * is unchanged (unless `force`), another upload is in flight, or the upload
 * failed.
 */
export async function sendBackupToTelegram(options: { force?: boolean } = {}): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.warn('[Backup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. Skipping auto-backup.');
        return false;
    }

    const dbPath = getDatabasePath();
    if (!fs.existsSync(dbPath)) {
        console.warn('[Backup] SQLite database file not found. Skipping backup.');
        return false;
    }

    if (backupInFlight) {
        console.log('[Backup] A backup upload is already in progress. Skipping duplicate request.');
        return false;
    }

    backupInFlight = true;
    try {
        const currentHash = await computeFileHash(dbPath);
        if (!options.force && currentHash === readLastBackupHash()) {
            console.log('[Backup] Database is unchanged since the last backup. Skipping duplicate upload.');
            return false;
        }

        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('document', fs.createReadStream(dbPath));
        form.append('caption', `Database Backup - ${new Date().toISOString()}`);

        console.log('[Backup] Sending database backup to Telegram...');
        const url = `https://api.telegram.org/bot${token}/sendDocument`;
        await axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        writeLastBackupHash(currentHash);
        console.log('[Backup] Database backup sent successfully to Telegram.');
        return true;
    } catch (err: any) {
        console.error('[Backup] Failed to send database backup to Telegram:', err.response?.data || err.message);
        return false;
    } finally {
        backupInFlight = false;
    }
}

/**
 * Dispatches a database backup outcome (success/failure) to the external status
 * channels via the status notifier. Never throws.
 *
 * @param success Whether a fresh snapshot was persisted.
 * @param hash    The SHA-256 digest of the database at backup time, if known.
 * @param reason  Failure reason (only used when `success` is false).
 * @param artifactDelivery Per-channel file-delivery summary for success reports.
 */
export async function dispatchBackupStatus(
    success: boolean,
    hash: string | null,
    reason?: string,
    artifactDelivery?: string
): Promise<void> {
    try {
        const { notify } = await import('../services/statusNotifier/notifier.js');
        if (success) {
            await notify(
                'DB_BACKUP_SUCCESS',
                'INFO',
                {
                    summary: 'SQLite database snapshot persisted successfully.',
                    fields: {
                        Hash: hash ? hash.slice(0, 16) : 'unchanged',
                        Database: 'storage/database.sqlite',
                        Artifacts: artifactDelivery ?? 'n/a'
                    },
                    sessionId: 'default'
                },
                { force: true }
            );
        } else {
            await notify(
                'DB_BACKUP_FAILED',
                'CRITICAL',
                {
                    summary: 'SQLite database backup failed.',
                    details: reason ? [reason] : undefined,
                    fields: { Hash: hash ? hash.slice(0, 16) : 'n/a' },
                    sessionId: 'default'
                },
                { dedupeKey: `DB_BACKUP_FAILED:${reason ?? 'unknown'}`, dedupeWindowMs: 60 * 60 * 1000 }
            );
        }
    } catch (err) {
        console.error('[Backup] Failed to dispatch backup status notification:', err);
    }
}

/**
 * Runs a full backup cycle: persists the snapshot to Telegram (unchanged
 * behavior), delivers the raw SQLite artifact to channels that support file
 * uploads (Discord, WhatsApp), and then reports the truthful outcome to every
 * enabled external status channel. Reports failure when no snapshot was
 * persisted anywhere; Telegram absence no longer suppresses status reporting.
 */
export async function runBackupCycle(options: { force?: boolean } = {}): Promise<boolean> {
    const dbPath = getDatabasePath();
    let hash: string | null = null;
    try {
        if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
            hash = await computeFileHash(dbPath);
        }
    } catch {
        hash = null;
    }

    let uploaded = false;
    try {
        uploaded = await sendBackupToTelegram(options);
    } catch (err) {
        console.error('[Backup] Telegram backup cycle threw:', err);
    }

    // Deliver the raw snapshot to file-capable channels as a best-effort extra.
    // Gated behind STATUS_NOTIFY_BACKUP_ARTIFACTS_ENABLED (default off): the
    // database contains session credentials and financial records, so raw
    // exfiltration to broad channel audiences requires explicit opt-in.
    const fileResults: string[] = [];
    let fileDelivered = false;
    let artifactsEnabled = false;
    try {
        const { getStatusNotifierConfig } = await import('../services/statusNotifier/config.js');
        artifactsEnabled = getStatusNotifierConfig().backupArtifacts.enabled;
    } catch (err) {
        console.error('[Backup] Failed to resolve artifact opt-in flag:', err);
    }
    if (hash && artifactsEnabled && fs.existsSync(dbPath)) {
        const fileName = `cosmos-database-${new Date().toISOString().slice(0, 10)}.sqlite`;
        const caption = `Cosmos database backup — SHA-256 ${hash.slice(0, 16)}…`;
        try {
            const { sendDiscordFile } = await import('../services/statusNotifier/transports/discord.js');
            const discordResult = await sendDiscordFile(dbPath, fileName, caption);
            if (!discordResult.skipped) {
                fileResults.push(`discord=${discordResult.success ? 'delivered' : 'failed'}`);
                if (discordResult.success) fileDelivered = true;
            }
        } catch (err) {
            console.error('[Backup] Discord artifact delivery failed:', err);
        }
        try {
            const { sendWhatsAppFile } = await import('../services/statusNotifier/transports/whatsappChannel.js');
            const waResult = await sendWhatsAppFile(dbPath, fileName, caption);
            if (!waResult.skipped) {
                fileResults.push(`whatsapp=${waResult.success ? 'delivered' : 'failed'}`);
                if (waResult.success) fileDelivered = true;
            }
        } catch (err) {
            console.error('[Backup] WhatsApp artifact delivery failed:', err);
        }
    }

    // Report success only when a snapshot was actually persisted somewhere:
    // Telegram upload, a file-channel delivery, or a genuine unchanged-database
    // skip. An unconfigured destination with a changed database is a failure so
    // monitoring can alert on "backups are not running".
    const fileAttempted = fileResults.length > 0;
    if (!hash) {
        await dispatchBackupStatus(false, hash, 'Database file is missing or unreadable; no backup was persisted.');
    } else if (uploaded || fileDelivered) {
        await dispatchBackupStatus(true, hash, undefined, fileResults.join(', ') || undefined);
    } else if (!fileAttempted && hash === readLastBackupHash() && !options.force) {
        // Telegram skipped because the database is unchanged since the last backup.
        await dispatchBackupStatus(true, hash, undefined, 'unchanged since last backup');
    } else if (!fileAttempted && !isTelegramConfigured()) {
        // Nothing configured while the database has changed: no snapshot exists
        // anywhere, so this must not report success.
        await dispatchBackupStatus(
            false,
            hash,
            'No backup destination is configured (Telegram credentials absent and artifact upload disabled) and the database has changed since the last backup.'
        );
    } else {
        await dispatchBackupStatus(
            false,
            hash,
            `Telegram upload failed and all attempted file deliveries failed (${fileResults.join(', ') || 'telegram only'}).`
        );
    }
    return uploaded;
}

/**
 * Sends a text notification through the same Telegram bot used for database
 * backups. Returns true only when the message was delivered successfully.
 */
export async function sendTelegramBotNotification(text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.warn('[Backup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing. Skipping Telegram notification.');
        return false;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        return true;
    } catch (err: any) {
        console.error('[Backup] Failed to send Telegram notification:', err.response?.data || err.message);
        return false;
    }
}

/**
 * Starts the Telegram auto-backup scheduler (once on startup, then daily at
 * 00:00 WIB). Safe to call multiple times; subsequent calls are no-ops.
 */
export function startAutoBackup(): void {
    if (autoBackupStarted) {
        console.log('[Backup] Auto-backup is already running. Skipping duplicate scheduler registration.');
        return;
    }
    autoBackupStarted = true;

    // Run a backup once on startup (skipped automatically when the database is unchanged)
    void runBackupCycle();

    // Schedule a backup daily at 00:00 WIB (Asia/Jakarta)
    cron.schedule(
        '0 0 * * *',
        () => {
            void runBackupCycle();
        },
        {
            timezone: 'Asia/Jakarta'
        }
    );

    console.log(`[Backup] Auto-backup started on startup and scheduled at 00:00 WIB daily.`);
}
