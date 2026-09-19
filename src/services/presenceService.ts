export type UserPresenceStatus = 'online' | 'offline';

export interface PresenceRecord {
    status: UserPresenceStatus;
    lastSeen: number; // Unix timestamp in ms
}

// In-memory presence cache keyed by clean phone digits
const presenceMap = new Map<string, PresenceRecord>();

// If marked online, but no presence update or message received for 5 minutes, mark as offline
const PRESENCE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Updates or sets the WhatsApp presence status for a given user or JID.
 */
export function updateUserPresence(
    jidOrPhone: string,
    status: UserPresenceStatus | string,
    lastSeen?: number | null
): void {
    const cleanPhone = jidOrPhone.split('@')[0].replace(/\D/g, '');
    if (!cleanPhone) return;

    const isOnline =
        status === 'available' ||
        status === 'composing' ||
        status === 'recording' ||
        status === 'paused' ||
        status === 'online';

    const finalStatus: UserPresenceStatus = isOnline ? 'online' : 'offline';
    let timestamp = Date.now();
    if (typeof lastSeen === 'number' && lastSeen > 0) {
        // Baileys may provide unix timestamp in seconds or ms
        timestamp = lastSeen < 1e11 ? lastSeen * 1000 : lastSeen;
    }

    presenceMap.set(cleanPhone, {
        status: finalStatus,
        lastSeen: timestamp
    });
}

/**
 * Returns the current presence status and last seen timestamp for a given JID or phone.
 */
export function getUserPresence(jidOrPhone: string): { status: UserPresenceStatus; lastSeen: number | null } {
    const cleanPhone = jidOrPhone.split('@')[0].replace(/\D/g, '');
    if (!cleanPhone) return { status: 'offline', lastSeen: null };

    const record = presenceMap.get(cleanPhone);
    if (!record) {
        return { status: 'offline', lastSeen: null };
    }

    // Check TTL: if status is online, but inactivity exceeds timeout, flip to offline
    if (record.status === 'online' && Date.now() - record.lastSeen > PRESENCE_TIMEOUT_MS) {
        record.status = 'offline';
    }

    return {
        status: record.status,
        lastSeen: record.lastSeen
    };
}
