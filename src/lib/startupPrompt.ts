import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

export type PairingMethod = 'code' | 'qr';

const MAX_RETRIES = 3;
const PHONE_PATTERN = /^\d{8,15}$/;

export function isInteractiveTerminal(): boolean {
    return Boolean(input.isTTY && output.isTTY);
}

/**
 * Strips leading +, spaces, dashes, and parentheses, then validates the result.
 * Returns the sanitized digit string, or null when invalid.
 */
export function sanitizePhoneNumber(raw: string): string | null {
    const sanitized = raw.trim().replace(/[+\s\-().]/g, '');
    if (PHONE_PATTERN.test(sanitized)) {
        return sanitized;
    }
    return null;
}

function resolveEnvPhoneNumber(): string | null {
    const raw = process.env.BOT_PHONE_NUMBER;
    if (!raw) return null;
    return sanitizePhoneNumber(raw);
}

function resolveEnvPairingMethod(): PairingMethod | null {
    const raw = process.env.PAIRING_METHOD?.trim().toLowerCase();
    if (raw === 'code' || raw === 'qr') return raw;
    return null;
}

async function promptLine(question: string): Promise<string> {
    const rl = createInterface({ input, output });
    try {
        return await rl.question(question);
    } finally {
        rl.close();
    }
}

function exitWithError(message: string): never {
    console.error(message);
    process.exit(1);
}

/**
 * Resolves the bot device phone number.
 * Uses an interactive prompt on TTY terminals, otherwise falls back to
 * BOT_PHONE_NUMBER for non-interactive runtimes.
 */
export async function promptBotPhoneNumber(): Promise<string> {
    if (!isInteractiveTerminal()) {
        const fallback = resolveEnvPhoneNumber();
        if (fallback) return fallback;
        exitWithError(
            'BOT_PHONE_NUMBER is not set and no interactive terminal is available. Please set BOT_PHONE_NUMBER in .env to enable non-interactive pairing.'
        );
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const answer = await promptLine(
            'Enter the bot WhatsApp number (country code without + or spaces, e.g. 628123456789): '
        );
        const sanitized = sanitizePhoneNumber(answer);
        if (sanitized) return sanitized;
        console.error(
            `Invalid phone number format. Please provide 8 to 15 digits without symbols (attempt ${attempt}/${MAX_RETRIES}).`
        );
    }

    exitWithError('Maximum pairing attempts exceeded. Please restart the process with a valid bot WhatsApp number.');
}

/**
 * Resolves the pairing method.
 * Uses an interactive prompt on TTY terminals, otherwise falls back to
 * PAIRING_METHOD (defaulting to code) for non-interactive runtimes.
 */
export async function promptPairingMethod(): Promise<PairingMethod> {
    if (!isInteractiveTerminal()) {
        return resolveEnvPairingMethod() || 'code';
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const answer = await promptLine(
            'Select the pairing method:\n  1) Pairing code (8-digit code entered in WhatsApp > Linked Devices)\n  2) QR code (scan from terminal)\nEnter choice [1/2] (default: 1): '
        );
        const normalized = answer.trim().toLowerCase();
        if (normalized === '' || normalized === '1' || normalized === 'code') return 'code';
        if (normalized === '2' || normalized === 'qr') return 'qr';
        console.error(
            `Invalid pairing method selection. Please enter 1 for pairing code or 2 for QR code (attempt ${attempt}/${MAX_RETRIES}).`
        );
    }

    exitWithError('Maximum pairing attempts exceeded. Please restart the process and select a valid pairing method.');
}

/**
 * Checks whether the default session already holds registered Baileys credentials.
 * Returns true when a registered session exists, false for fresh or logged-out devices.
 */
export async function isDefaultSessionRegistered(): Promise<boolean> {
    try {
        const rawPath = process.env.DATABASE_URL?.replace(/^file:/, '') || './storage/database.sqlite';
        const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
        if (!fs.existsSync(dbPath)) return false;
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        try {
            const row = db.prepare('SELECT value FROM "WhatsAppAuth" WHERE id = ?').get('default_creds.json') as
                { value: string } | undefined;
            if (!row?.value) return false;
            const creds = JSON.parse(row.value as string) as { registered?: boolean };
            return creds?.registered === true;
        } catch {
            return false;
        } finally {
            try {
                db.close();
            } catch {
                /* ignore */
            }
        }
    } catch {
        return false;
    }
}
