import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import cron from 'node-cron';

const BACKUP_HASH_FILENAME = '.telegram-backup-hash';

let backupInFlight = false;
let autoBackupStarted = false;

function getDatabasePath(): string {
    return path.resolve(process.cwd(), 'storage/database.sqlite');
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

function readLastBackupHash(): string | null {
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

export function startAutoBackup(): void {
    if (autoBackupStarted) {
        console.log('[Backup] Auto-backup is already running. Skipping duplicate scheduler registration.');
        return;
    }
    autoBackupStarted = true;

    // Run a backup once on startup (skipped automatically when the database is unchanged)
    void sendBackupToTelegram();

    // Schedule a backup daily at 00:00 WIB (Asia/Jakarta)
    cron.schedule(
        '0 0 * * *',
        () => {
            void sendBackupToTelegram();
        },
        {
            timezone: 'Asia/Jakarta'
        }
    );

    console.log(`[Backup] Auto-backup started on startup and scheduled at 00:00 WIB daily.`);
}
