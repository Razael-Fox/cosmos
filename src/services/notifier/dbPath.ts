/**
 * External Status Notification subsystem — shared database path resolver.
 *
 * Single source of truth for locating the bot SQLite file so the backup
 * pipeline, health monitor, and database guard always operate on the same
 * file. Honors `DATABASE_URL` with the same `/app/storage` container fallback
 * used across the codebase.
 */
import fs from 'fs';
import path from 'path';

/** Resolves the absolute path of the default bot SQLite database file. */
export function resolveStatusDatabasePath(): string {
    const raw = process.env.DATABASE_URL?.replace('file:', '') || './storage/database.sqlite';
    if (raw.startsWith('/app/storage') && !fs.existsSync('/app')) {
        return path.resolve(process.cwd(), 'storage', 'database.sqlite');
    }
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}
