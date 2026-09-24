/**
 * Utility functions for phone number normalization, JID formatting, and privacy masking.
 */

/**
 * Strips all non-digit characters from a phone number or JID.
 * Converts Indonesian local leading 0 (e.g., 0812...) to international country code 62812...
 */
export function cleanPhoneNumber(input: string): string {
    if (!input) return '';
    const cleaned = input.split('@')[0].split(':')[0].trim();
    let digits = cleaned.replace(/\D/g, '');
    if (digits.startsWith('0')) {
        digits = '62' + digits.slice(1);
    }
    return digits;
}

/**
 * Converts a phone number string to a canonical WhatsApp JID (@s.whatsapp.net).
 */
export function toCanonicalJid(phoneOrJid: string): string {
    const digits = cleanPhoneNumber(phoneOrJid);
    if (!digits) {
        throw new Error(`Invalid phone number: "${phoneOrJid}"`);
    }
    return `${digits}@s.whatsapp.net`;
}

/**
 * Masks a phone number for privacy display and console logging (e.g., 62812****7890).
 */
export function maskPhoneNumber(phoneOrJid: string | null | undefined): string {
    if (!phoneOrJid) return '';
    const digits = cleanPhoneNumber(phoneOrJid);
    if (!digits) return '';

    if (digits.length >= 9) {
        const prefix = digits.slice(0, 5);
        const suffix = digits.slice(-4);
        return `${prefix}****${suffix}`;
    }

    if (digits.length >= 4) {
        const prefix = digits.slice(0, 2);
        const suffix = digits.slice(-2);
        return `${prefix}****${suffix}`;
    }

    return '****';
}
