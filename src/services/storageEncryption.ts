import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function resolveKey(): Buffer | null {
    const raw = process.env.STORAGE_ENCRYPTION_KEY;
    if (!raw) return null;
    // Accept 64-char hex (32 bytes) or raw passphrase (hashed to 32 bytes).
    if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
        return Buffer.from(raw.trim(), 'hex');
    }
    return crypto.createHash('sha256').update(raw).digest();
}

export function isStorageEncryptionEnabled(): boolean {
    return resolveKey() !== null;
}

/**
 * Encrypts sensitive Baileys auth credentials at rest.
 * Structure: [12 bytes IV] + [16 bytes Auth Tag] + [Ciphertext]
 */
export function encryptSessionData(plainText: Buffer, key?: Buffer): Buffer {
    const resolved = key ?? resolveKey();
    if (!resolved) throw new Error('STORAGE_ENCRYPTION_KEY is not configured.');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, resolved, iv);
    const encrypted = Buffer.concat([cipher.update(plainText), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypts authenticated session credentials with integrity verification.
 */
export function decryptSessionData(buffer: Buffer, key?: Buffer): Buffer {
    const resolved = key ?? resolveKey();
    if (!resolved) throw new Error('STORAGE_ENCRYPTION_KEY is not configured.');
    if (buffer.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error('CORRUPT_ENCRYPTED_SESSION_DATA: Buffer too short');
    }
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, resolved, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptString(plain: string, key?: Buffer): string {
    return encryptSessionData(Buffer.from(plain, 'utf8'), key).toString('base64');
}

export function decryptString(payload: string, key?: Buffer): string {
    return decryptSessionData(Buffer.from(payload, 'base64'), key).toString('utf8');
}
