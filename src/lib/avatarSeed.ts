/**
 * Deterministic DiceBear avatar placeholder utility.
 * Produces a stable avatar URL based on user NIK (primary) or phone digits (fallback).
 * Style: 'thumbs' — friendly cartoon avatar suitable for ID cards and dashboards.
 */

const DICEBEAR_BASE_URL = 'https://api.dicebear.com/10.x';
const AVATAR_STYLE = 'thumbs';

/**
 * Extracts a stable numeric seed from a WhatsApp JID or raw phone number.
 * e.g., '628123456789@s.whatsapp.net' -> '628123456789'
 */
export function phoneDigitsFromJid(jidOrPhone: string): string {
    return jidOrPhone.split('@')[0].replace(/\D/g, '');
}

/**
 * Generates a deterministic DiceBear avatar URL.
 * Prefer NIK as seed for maximum stability (NIK never changes).
 * Falls back to phone digits if NIK is unavailable.
 */
export function buildAvatarPlaceholderUrl(seed: string): string {
    const encoded = encodeURIComponent(seed);
    return `${DICEBEAR_BASE_URL}/${AVATAR_STYLE}/svg?seed=${encoded}`;
}

/**
 * Returns the DiceBear avatar placeholder URL for a user.
 * @param nik - The user's 16-digit NIK from IdCard (preferred seed)
 * @param jidOrPhone - WhatsApp JID or phone string (fallback seed)
 */
export function getAvatarPlaceholderUrl(nik: string | null | undefined, jidOrPhone: string): string {
    const seed = nik && nik.trim() ? nik.trim() : phoneDigitsFromJid(jidOrPhone);
    return buildAvatarPlaceholderUrl(seed);
}
