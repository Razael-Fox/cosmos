import fs from 'fs';
import path from 'path';
import { prisma } from '#db.js';

export type UserPresenceStatus = 'online' | 'offline';

export interface PresenceRecord {
    status: UserPresenceStatus;
    lastSeen: number; // Unix timestamp in ms
}

function getPresenceFilePath(): string {
    if (fs.existsSync('/app/storage')) {
        return '/app/storage/presence.json';
    }
    return path.join(process.cwd(), 'storage', 'presence.json');
}

const PRESENCE_TIMEOUT_MS = 5 * 60 * 1000;

// In-memory presence map: key is clean digits (e.g. phone or LID digits)
const presenceMap = new Map<string, PresenceRecord>();
// Bidirectional mapping between phone digits and LID digits
const idLinkMap = new Map<string, string>();

// Load presence records from disk if available
function loadPresenceFromDisk(): void {
    try {
        const filePath = getPresenceFilePath();
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                for (const [key, val] of Object.entries(data)) {
                    if (val && typeof val === 'object' && 'status' in val && 'lastSeen' in val) {
                        presenceMap.set(key, val as PresenceRecord);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[Presence] Failed to load presence cache from disk:', e);
    }
}

// Debounced save to disk
let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave(): void {
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        try {
            const filePath = getPresenceFilePath();
            const obj: Record<string, PresenceRecord> = {};
            for (const [k, v] of presenceMap.entries()) {
                obj[k] = v;
            }
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(obj), 'utf8');
        } catch (e) {
            console.warn('[Presence] Failed to persist presence cache:', e);
        }
    }, 1500);
}

// Initialize on module load
loadPresenceFromDisk();

/**
 * Associates two IDs together (e.g. user phone JID and user LID).
 */
export function linkPresenceIds(id1?: string | null, id2?: string | null): void {
    if (!id1 || !id2) return;
    const clean1 = id1.split('@')[0].replace(/\D/g, '');
    const clean2 = id2.split('@')[0].replace(/\D/g, '');
    if (!clean1 || !clean2 || clean1 === clean2) return;

    idLinkMap.set(clean1, clean2);
    idLinkMap.set(clean2, clean1);
}

/**
 * Updates or sets the WhatsApp presence status for a given user or JID/LID.
 */
export async function updateUserPresence(
    jidOrPhoneOrLid: string,
    status: UserPresenceStatus | string,
    lastSeen?: number | null
): Promise<void> {
    const cleanId = jidOrPhoneOrLid.split('@')[0].replace(/\D/g, '');
    if (!cleanId) return;

    const isOnline =
        status === 'available' ||
        status === 'composing' ||
        status === 'recording' ||
        status === 'paused' ||
        status === 'online';

    const finalStatus: UserPresenceStatus = isOnline ? 'online' : 'offline';
    let timestamp = Date.now();
    if (typeof lastSeen === 'number' && lastSeen > 0) {
        timestamp = lastSeen < 1e11 ? lastSeen * 1000 : lastSeen;
    }

    const record: PresenceRecord = {
        status: finalStatus,
        lastSeen: timestamp
    };

    presenceMap.set(cleanId, record);

    // Check in-memory link
    let linked = idLinkMap.get(cleanId);
    if (!linked) {
        try {
            const canonicalJid = `${cleanId}@s.whatsapp.net`;
            const user = await prisma.user.findFirst({
                where: {
                    OR: [{ id: canonicalJid }, { id: cleanId }, { lid: cleanId }]
                },
                select: { id: true, lid: true }
            });
            if (user) {
                const userCleanPhone = user.id.split('@')[0].replace(/\D/g, '');
                const userCleanLid = user.lid ? user.lid.split('@')[0].replace(/\D/g, '') : null;
                if (userCleanPhone && userCleanLid) {
                    linkPresenceIds(userCleanPhone, userCleanLid);
                    linked = userCleanPhone === cleanId ? userCleanLid : userCleanPhone;
                }
            }
        } catch {
            /* non-fatal */
        }
    }

    if (linked) {
        presenceMap.set(linked, record);
    }

    scheduleSave();
}

/**
 * Returns the current presence status and last seen timestamp for a given JID or phone.
 */
export async function getUserPresence(
    jidOrPhone: string
): Promise<{ status: UserPresenceStatus; lastSeen: number | null }> {
    const cleanId = jidOrPhone.split('@')[0].replace(/\D/g, '');
    if (!cleanId) return { status: 'offline', lastSeen: null };

    // 1. Direct check in presenceMap
    let record = presenceMap.get(cleanId);

    // 2. Check linked ID
    let linked = idLinkMap.get(cleanId);
    if (!linked) {
        try {
            const canonicalJid = `${cleanId}@s.whatsapp.net`;
            const user = await prisma.user.findFirst({
                where: {
                    OR: [{ id: canonicalJid }, { id: cleanId }, { lid: cleanId }]
                },
                select: { id: true, lid: true }
            });
            if (user) {
                const userCleanPhone = user.id.split('@')[0].replace(/\D/g, '');
                const userCleanLid = user.lid ? user.lid.split('@')[0].replace(/\D/g, '') : null;
                if (userCleanPhone && userCleanLid) {
                    linkPresenceIds(userCleanPhone, userCleanLid);
                    linked = userCleanPhone === cleanId ? userCleanLid : userCleanPhone;
                }
            }
        } catch {
            /* non-fatal */
        }
    }

    if (linked) {
        const linkedRecord = presenceMap.get(linked);
        if (linkedRecord) {
            if (!record || linkedRecord.lastSeen > record.lastSeen) {
                record = linkedRecord;
            }
        }
    }

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
