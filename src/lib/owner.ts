import { cleanId } from './casino.js';

let deprecationWarned = false;

function sanitizeOwnerEntry(entry: string): string | null {
    const cleaned = cleanId(entry.trim());
    const digits = cleaned.replace(/\D/g, '');
    if (/^\d{8,15}$/.test(digits)) {
        return digits;
    }
    return null;
}

/**
 * Resolves the configured owner phone numbers.
 * Reads OWNER_PHONE_NUMBER (comma-separated) and falls back to the legacy
 * BOT_PHONE_NUMBER value with a one-time deprecation warning.
 */
export function getOwnerNumbers(): string[] {
    const rawOwner = process.env.OWNER_PHONE_NUMBER;
    if (rawOwner && rawOwner.trim().length > 0) {
        const numbers = rawOwner
            .split(',')
            .map((entry) => sanitizeOwnerEntry(entry))
            .filter((entry): entry is string => entry !== null);
        return [...new Set(numbers)];
    }

    const legacy = process.env.BOT_PHONE_NUMBER;
    if (legacy && legacy.trim().length > 0) {
        const fallback = sanitizeOwnerEntry(legacy);
        if (fallback) {
            if (!deprecationWarned) {
                deprecationWarned = true;
                console.warn(
                    '[System] OWNER_PHONE_NUMBER is not set. Falling back to BOT_PHONE_NUMBER for owner authorization. Please set OWNER_PHONE_NUMBER in .env as this fallback is deprecated and will be removed in a later release.'
                );
            }
            return [fallback];
        }
    }

    return [];
}

/**
 * Checks whether a raw sender identifier (JID, LID, device JID, or plain number)
 * matches one of the configured owner numbers.
 */
export function isOwnerId(idStr?: string | null): boolean {
    if (!idStr) return false;
    const cleaned = cleanId(idStr).replace(/\D/g, '');
    if (!cleaned) return false;
    return getOwnerNumbers().includes(cleaned);
}

/**
 * Returns the primary owner number, or null when no owner is configured.
 */
export function getPrimaryOwnerNumber(): string | null {
    const numbers = getOwnerNumbers();
    return numbers.length > 0 ? numbers[0] : null;
}
