import fs from 'fs';
import path from 'path';
import { prisma } from '#db.js';

const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const LOCAL_FILE = path.join(STORAGE_DIR, 'active_sessions.json');

export interface ActiveSessionRecord {
    feature: string;
    jid: string;
    metadata?: Record<string, any>;
    created_at?: string;
}

// In-memory cache: Map<feature, Set<jid>>
const memoryStore = new Map<string, Map<string, Record<string, any>>>();

function ensureStorageDir(): void {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

function loadLocalFile(): ActiveSessionRecord[] {
    ensureStorageDir();
    if (!fs.existsSync(LOCAL_FILE)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(LOCAL_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('[SessionStore] Error reading local session file:', err);
        return [];
    }
}

function saveLocalFile(): void {
    ensureStorageDir();
    const records: ActiveSessionRecord[] = [];
    for (const [feature, jidMap] of memoryStore.entries()) {
        for (const [jid, metadata] of jidMap.entries()) {
            records.push({
                feature,
                jid,
                metadata
            });
        }
    }
    try {
        fs.writeFileSync(LOCAL_FILE, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
        console.error('[SessionStore] Error writing local session file:', err);
    }
}

/**
 * Initializes active sessions from Prisma (or local fallback file).
 */
export async function initActiveSessions(): Promise<void> {
    memoryStore.clear();

    try {
        const data = await prisma.activeSession.findMany();
        if (data && data.length > 0) {
            for (const row of data) {
                if (!memoryStore.has(row.feature)) {
                    memoryStore.set(row.feature, new Map());
                }
                memoryStore.get(row.feature)!.set(row.jid, row.metadata ? JSON.parse(row.metadata) : {});
            }
            saveLocalFile(); // Keep local fallback in sync
            console.log(`[SessionStore] Loaded ${data.length} active session(s) from local database.`);
            return;
        }
    } catch (err) {
        console.error('[SessionStore] Exception fetching sessions from local database:', err);
    }

    // Fallback to local file if DB is empty or failed
    const localData = loadLocalFile();
    for (const row of localData) {
        if (!memoryStore.has(row.feature)) {
            memoryStore.set(row.feature, new Map());
        }
        memoryStore.get(row.feature)!.set(row.jid, row.metadata || {});
    }
    console.log(`[SessionStore] Loaded ${localData.length} active session(s) from local file.`);
}

/**
 * Checks if a feature is active for a JID.
 */
export function isSessionActive(feature: string, jid: string): boolean {
    const jidMap = memoryStore.get(feature);
    return jidMap ? jidMap.has(jid) : false;
}

/**
 * Gets session metadata if active.
 */
export function getSessionMetadata(feature: string, jid: string): Record<string, any> | null {
    const jidMap = memoryStore.get(feature);
    if (!jidMap) return null;
    return jidMap.get(jid) || null;
}

/**
 * Activates a feature session for a JID.
 */
export async function activateSession(feature: string, jid: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!memoryStore.has(feature)) {
        memoryStore.set(feature, new Map());
    }
    memoryStore.get(feature)!.set(jid, metadata);
    saveLocalFile();

    try {
        const metadataStr = JSON.stringify(metadata);
        await prisma.activeSession.upsert({
            where: {
                feature_jid: {
                    feature,
                    jid
                }
            },
            update: { metadata: metadataStr },
            create: { feature, jid, metadata: metadataStr }
        });
    } catch (err) {
        console.error(`[SessionStore] Exception persisting activateSession (${feature}, ${jid}):`, err);
    }
}

/**
 * Deactivates a feature session for a JID.
 */
export async function deactivateSession(feature: string, jid: string): Promise<boolean> {
    const jidMap = memoryStore.get(feature);
    if (!jidMap || !jidMap.has(jid)) {
        return false;
    }
    jidMap.delete(jid);
    saveLocalFile();

    try {
        await prisma.activeSession.delete({
            where: {
                feature_jid: {
                    feature,
                    jid
                }
            }
        });
    } catch (err) {
        // Ignore record not found error
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
            return true;
        }
        console.error(`[SessionStore] Exception persisting deactivateSession (${feature}, ${jid}):`, err);
    }
    return true;
}

/**
 * Toggles a feature session for a JID.
 * Returns true if activated, false if deactivated.
 */
export async function toggleSession(
    feature: string,
    jid: string,
    metadata: Record<string, any> = {}
): Promise<boolean> {
    if (isSessionActive(feature, jid)) {
        await deactivateSession(feature, jid);
        return false;
    } else {
        await activateSession(feature, jid, metadata);
        return true;
    }
}

/**
 * Returns all active JIDs for a feature.
 */
export function getActiveJids(feature: string): string[] {
    const jidMap = memoryStore.get(feature);
    if (!jidMap) return [];
    return Array.from(jidMap.keys());
}
