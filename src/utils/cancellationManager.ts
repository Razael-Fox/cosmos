import { cleanId } from '#utils/casino.js';

export interface CancellableSession {
    /** Unique identifier for this cancellable session */
    sessionId: string;
    /** Feature/tool name that registered the session (e.g. 'idcard', 'roulette') */
    feature: string;
    /** The user ID (JID/LID or clean phone number) who owns this session */
    userJid: string;
    /** The chat / remote JID where this session is active */
    chatJid: string;
    /** Human-readable description of what is being cancelled */
    description?: string;
    /** Timestamp when the session was created */
    createdAt?: number;
    /**
     * Handler invoked when cancellation is requested.
     * Can send its own message via sock and/or return a string message to reply with.
     */
    onCancel: (sock: any, msg: any) => Promise<string | void> | string | void;
}

// In-memory registry of active cancellable sessions
const activeSessions = new Map<string, CancellableSession>();

/**
 * Normalizes user ID and chat ID for consistent lookup key.
 */
function getLookupKey(userJid: string, chatJid: string): string {
    const cleanUser = cleanId(userJid).toLowerCase();
    const cleanChat = cleanId(chatJid).toLowerCase();
    return `${cleanUser}:${cleanChat}`;
}

/**
 * Registers an active cancellable session into the global registry.
 */
export function registerCancellableSession(session: CancellableSession): void {
    const key = getLookupKey(session.userJid, session.chatJid);
    activeSessions.set(key, {
        ...session,
        createdAt: session.createdAt || Date.now()
    });
}

/**
 * Unregisters a session by its sessionId or user/chat pair.
 */
export function unregisterCancellableSession(sessionId: string): boolean {
    for (const [key, session] of activeSessions.entries()) {
        if (session.sessionId === sessionId) {
            activeSessions.delete(key);
            return true;
        }
    }
    return false;
}

/**
 * Unregisters a session by user ID and chat ID.
 */
export function unregisterCancellableSessionByUser(userJid: string, chatJid: string): boolean {
    const key = getLookupKey(userJid, chatJid);
    return activeSessions.delete(key);
}

/**
 * Unregisters all sessions belonging to a specific feature.
 */
export function unregisterCancellableSessionsByFeature(feature: string): void {
    for (const [key, session] of activeSessions.entries()) {
        if (session.feature === feature) {
            activeSessions.delete(key);
        }
    }
}

/**
 * Finds an active cancellable session for a user in a given chat.
 */
export function findCancellableSession(userJid: string, chatJid: string): CancellableSession | undefined {
    const key = getLookupKey(userJid, chatJid);
    return activeSessions.get(key);
}

/**
 * Checks whether a user has an active cancellable session in a given chat.
 */
export function hasCancellableSession(userJid: string, chatJid: string): boolean {
    return findCancellableSession(userJid, chatJid) !== undefined;
}

/**
 * Executes cancellation on any active session for a user in a given chat.
 * Returns the cancellation message if cancelled, or null if no session was found.
 */
export async function cancelActiveSession(
    userJid: string,
    chatJid: string,
    sock: any,
    msg: any,
    t?: (key: string, vars?: Record<string, any>) => string
): Promise<string | null> {
    const session = findCancellableSession(userJid, chatJid);
    if (!session) {
        return null;
    }

    // Remove from registry first to prevent re-entrant calls
    unregisterCancellableSessionByUser(userJid, chatJid);

    try {
        const result = await session.onCancel(sock, msg);
        if (typeof result === 'string') {
            return result;
        }
        if (t) {
            return t('utilities.cancellation.session_cancelled', { feature: session.description || session.feature });
        }
        return `The active ${session.description || session.feature} operation has been successfully cancelled.`;
    } catch (err) {
        console.error(`[CancellationManager] Error during onCancel for ${session.sessionId}:`, err);
        if (t) {
            return t('utilities.cancellation.cancel_failed', { error: (err as Error).message });
        }
        return `Failed to cleanly cancel the operation: ${(err as Error).message}`;
    }
}

/**
 * Clears all active cancellable sessions (used mainly for tests).
 */
export function clearAllCancellableSessions(): void {
    activeSessions.clear();
}
