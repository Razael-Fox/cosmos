import crypto from 'crypto';
import { config } from '../config.js';

export function generateOtpCode(): string {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export function generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function hashOtp(code: string, salt: string): string {
    return crypto.createHmac('sha256', config.OTP_SECRET).update(`${salt}:${code}`).digest('hex');
}

export function normalizeToken(token: string): string {
    return token.trim().toUpperCase();
}

/**
 * Deterministic, indexed lookup key for O(1) record retrieval.
 * Uses HMAC with the server OTP secret (not plain SHA-256) so the value is
 * not brute-forceable from a database dump alone.
 */
export function tokenLookupHash(token: string): string {
    return crypto.createHmac('sha256', config.OTP_SECRET).update(normalizeToken(token)).digest('hex');
}

export function timingSafeStringCompare(a: string, b: string): boolean {
    const aHash = crypto.createHash('sha256').update(a).digest();
    const bHash = crypto.createHash('sha256').update(b).digest();
    if (aHash.length !== bHash.length) return false;
    return crypto.timingSafeEqual(aHash, bHash);
}

export function generateInvertedToken(phoneNumber: string): string {
    const clean = phoneNumber.replace(/\D/g, '');
    const random = crypto.randomBytes(16).toString('hex').toUpperCase();
    return `COSMOS-${random.slice(0, 6)}-${clean.slice(-4)}`;
}

export function verifyAdminKey(providedHeader?: string): boolean {
    const adminKey = config.ADMIN_API_KEY;
    if (!adminKey || !providedHeader) return false;
    const token = providedHeader.startsWith('Bearer ') ? providedHeader.slice(7).trim() : providedHeader.trim();
    return timingSafeStringCompare(token, adminKey);
}

export function buildClickToChatUrl(botNumber: string, token: string): { universal: string; direct: string } {
    const clean = botNumber.replace(/\D/g, '');
    const text = encodeURIComponent(`.verify ${token}`);
    return {
        // Universal link — opens in browser, OS dispatches to any WhatsApp variant
        universal: `https://wa.me/${clean}?text=${text}`,
        // Deep link — only opens regular WhatsApp (not WhatsApp Business)
        direct: `whatsapp://send?phone=${clean}&text=${text}`
    };
}

/**
 * Secure password hashing using scrypt with a random 16-byte salt.
 * Formatted as "salt:hash".
 */
export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, key] = parts;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return timingSafeStringCompare(derivedKey.toString('hex'), key);
}
