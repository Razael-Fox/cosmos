import crypto from 'crypto';
import { prisma } from '#db.js';

export interface GeneratedOtp {
    code: string;
    hash: string;
    salt: string;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;

function otpSecret(): string {
    return process.env.OTP_SECRET || 'cosmos-dev-otp-secret-change-me';
}

export function generateOtpCode(): string {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export function generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function hashOtp(code: string, salt: string): string {
    return crypto.createHmac('sha256', otpSecret()).update(`${salt}:${code}`).digest('hex');
}

export function normalizeToken(token: string): string {
    return token.trim().toUpperCase();
}

/**
 * Deterministic, indexed lookup key for O(1) record retrieval.
 * Uses HMAC with the server OTP secret (not plain SHA-256) so the value is
 * not brute-forceable from a database dump alone. The per-record salted
 * `codeHash` remains the actual verifier via timing-safe comparison.
 */
export function tokenLookupHash(token: string): string {
    return crypto.createHmac('sha256', otpSecret()).update(normalizeToken(token)).digest('hex');
}

export function timingSafeStringCompare(a: string, b: string): boolean {
    const aHash = crypto.createHash('sha256').update(a).digest();
    const bHash = crypto.createHash('sha256').update(b).digest();
    if (aHash.length !== bHash.length) return false;
    return crypto.timingSafeEqual(aHash, bHash);
}

export function generateOtp(): GeneratedOtp {
    const code = generateOtpCode();
    const salt = generateSalt();
    return { code, salt, hash: hashOtp(code, salt) };
}

export function generateInvertedToken(phoneNumber: string): string {
    const random = crypto.randomBytes(16).toString('hex').toUpperCase();
    return `COSMOS-${random.slice(0, 6)}-${phoneNumber.slice(-4)}`;
}

export interface CreateOtpOptions {
    phoneNumber: string;
    purpose?: string;
    userJid?: string | null;
    metadata?: Record<string, unknown> | null;
    regSessionId?: string | null;
}

/** Creates a direct OTP record with HMAC-SHA256 salted hash storage. Returns the plain code once. */
export async function createDirectOtp(
    options: CreateOtpOptions
): Promise<{ id: string; code: string; expiresAt: Date }> {
    const clean = options.phoneNumber.replace(/\D/g, '');
    const { code, hash, salt } = generateOtp();
    const record = await prisma.otpVerification.create({
        data: {
            phoneNumber: clean,
            userJid: options.userJid ?? null,
            codeHash: hash,
            salt,
            lookupHash: tokenLookupHash(code),
            metadata: options.metadata ? JSON.stringify(options.metadata) : null,
            regSessionId: options.regSessionId ?? null,
            purpose: options.purpose ?? 'REGISTRATION',
            maxAttempts: OTP_MAX_ATTEMPTS,
            expiresAt: new Date(Date.now() + OTP_TTL_MS)
        }
    });
    return { id: record.id, code, expiresAt: record.expiresAt };
}

/** Creates an inverted verification token record (user-initiated WhatsApp verification, zero ban risk). */
export async function createInvertedVerification(
    phoneNumber: string,
    metadata?: Record<string, unknown> | null
): Promise<{ token: string; regSessionId: string; expiresAt: Date }> {
    const clean = phoneNumber.replace(/\D/g, '');
    const token = generateInvertedToken(clean);
    const salt = generateSalt();
    const regSessionId = crypto.randomBytes(24).toString('hex');
    const record = await prisma.otpVerification.create({
        data: {
            phoneNumber: clean,
            userJid: null,
            codeHash: hashOtp(token, salt),
            salt,
            lookupHash: tokenLookupHash(token),
            metadata: metadata ? JSON.stringify(metadata) : null,
            regSessionId,
            purpose: 'INVERTED_REGISTRATION',
            maxAttempts: OTP_MAX_ATTEMPTS,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }
    });
    return { token, regSessionId: record.regSessionId as string, expiresAt: record.expiresAt };
}

/** Timing-safe OTP verification with atomic attempt increment. */
export async function verifyOtp(id: string, code: string): Promise<{ ok: boolean; reason?: string }> {
    const record = await prisma.otpVerification.findUnique({ where: { id } });
    if (!record || record.isUsed) return { ok: false, reason: 'NOT_FOUND' };
    if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
    if (record.attempts >= record.maxAttempts) return { ok: false, reason: 'LOCKED' };
    const expected = hashOtp(code.trim(), record.salt);
    const matches = timingSafeStringCompare(expected, record.codeHash);
    if (!matches) {
        await prisma.otpVerification.update({
            where: { id },
            data: { attempts: { increment: 1 } }
        });
        return { ok: false, reason: 'MISMATCH' };
    }
    return { ok: true };
}

export interface VerifyInvertedRecord {
    id: string;
    phoneNumber: string;
    metadata: Record<string, unknown> | null;
    regSessionId: string | null;
    attempts: number;
    maxAttempts: number;
    expiresAt: Date;
}

/** Timing-safe inverted token verification used by the `.verify` command. */
export async function verifyInvertedToken(
    token: string
): Promise<{ ok: boolean; reason?: string; record?: VerifyInvertedRecord }> {
    const normalized = normalizeToken(token);
    // O(1) indexed lookup instead of loading every pending record into memory.
    const indexed = await prisma.otpVerification.findFirst({
        where: { purpose: 'INVERTED_REGISTRATION', isUsed: false, lookupHash: tokenLookupHash(normalized) }
    });
    if (indexed) return toInvertedMatch(indexed, normalized);

    // Bounded fallback for rows created before `lookupHash` existed (unverifiable
    // via index). That set only shrinks — no new null rows are written — and every
    // member expires within 30 minutes of deploy. Matched rows are backfilled.
    const legacy = await prisma.otpVerification.findMany({
        where: { purpose: 'INVERTED_REGISTRATION', isUsed: false, lookupHash: null }
    });
    for (const record of legacy) {
        const expected = hashOtp(normalized, record.salt);
        if (!timingSafeStringCompare(expected, record.codeHash)) continue;
        await prisma.otpVerification
            .update({ where: { id: record.id }, data: { lookupHash: tokenLookupHash(normalized) } })
            .catch((err) => console.error('[OTP] Failed to backfill lookupHash:', err));
        return toInvertedMatch(record, normalized);
    }
    return { ok: false, reason: 'NOT_FOUND' };
}

function toInvertedMatch(
    record: {
        id: string;
        phoneNumber: string;
        metadata: string | null;
        regSessionId: string | null;
        attempts: number;
        maxAttempts: number;
        expiresAt: Date;
        codeHash: string;
        salt: string;
    },
    normalized: string
): { ok: boolean; reason?: string; record?: VerifyInvertedRecord } {
    // The salted codeHash remains the actual verifier; the index only locates.
    if (!timingSafeStringCompare(hashOtp(normalized, record.salt), record.codeHash)) {
        console.error('[OTP] Indexed lookupHash matched but codeHash mismatched (data corruption).');
        return { ok: false, reason: 'NOT_FOUND' };
    }
    if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
    if (record.attempts >= record.maxAttempts) return { ok: false, reason: 'LOCKED' };
    let metadata: Record<string, unknown> | null;
    try {
        metadata = record.metadata ? (JSON.parse(record.metadata) as Record<string, unknown>) : null;
    } catch {
        metadata = null;
    }
    return {
        ok: true,
        record: {
            id: record.id,
            phoneNumber: record.phoneNumber,
            metadata,
            regSessionId: record.regSessionId,
            attempts: record.attempts,
            maxAttempts: record.maxAttempts,
            expiresAt: record.expiresAt
        }
    };
}

/**
 * Records a failed inverted-verification attempt (unknown token or sender mismatch).
 * Burns one attempt on the matched record so tokens cannot be probed indefinitely;
 * once `attempts >= maxAttempts` the record is locked and ignored by verification.
 */
export async function registerInvertedMismatch(id: string): Promise<void> {
    try {
        await prisma.otpVerification.update({
            where: { id },
            data: { attempts: { increment: 1 } }
        });
    } catch (err) {
        console.error('[OTP] Failed to record inverted verification attempt:', err);
    }
}

export function verifyAdminKey(providedHeader?: string): boolean {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey || !providedHeader) return false;
    const token = providedHeader.startsWith('Bearer ') ? providedHeader.slice(7).trim() : providedHeader.trim();
    return timingSafeStringCompare(token, adminKey);
}

export function buildClickToChatUrl(botNumber: string, token: string): string {
    const clean = botNumber.replace(/\D/g, '');
    return `https://wa.me/${clean}?text=${encodeURIComponent(`.verify ${token}`)}`;
}
