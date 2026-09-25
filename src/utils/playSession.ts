import { proto } from '@whiskeysockets/baileys';
import { cleanId } from '#utils/casino.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';

export interface PlaySearchResult {
    index: number;
    title: string;
    url: string;
}

export interface PlaySession {
    userJid: string;
    chatJid: string;
    query: string;
    results: PlaySearchResult[];
    enableLyrics?: boolean;
    messageKey?: proto.IMessageKey;
    timer?: NodeJS.Timeout;
    createdAt: number;
}

const activePlaySessions = new Map<string, PlaySession>();

function getSessionKey(userJid: string, chatJid: string): string {
    const cleanUser = cleanId(userJid).toLowerCase();
    const cleanChat = cleanId(chatJid).toLowerCase();
    return `${cleanUser}:${cleanChat}`;
}

/**
 * Registers an active YouTube playback selection session into memory and
 * hooks it into the global cancellation manager (.cancel).
 */
export function registerPlaySession(
    session: PlaySession,
    t?: (key: string, vars?: Record<string, any>) => string
): void {
    const cleanUser = cleanId(session.userJid).toLowerCase();
    const cleanChat = cleanId(session.chatJid).toLowerCase();
    const key = getSessionKey(cleanUser, cleanChat);

    // Clear any existing session for this user in this chat
    clearPlaySession(cleanUser, cleanChat);

    // Auto-expiry timer (2 minutes = 120,000 ms)
    const timer = setTimeout(() => {
        clearPlaySession(cleanUser, cleanChat);
    }, 120000);

    session.timer = timer;
    activePlaySessions.set(key, session);

    // Register with global cancellation system (.cancel)
    registerCancellableSession({
        sessionId: `play_${cleanUser}_${cleanChat}`,
        feature: 'play',
        userJid: cleanUser,
        chatJid: session.chatJid,
        descriptionKey: 'media.play.cancellation_desc',
        descriptionVars: { query: session.query },
        description: `YouTube music search for "${session.query}"`,
        onCancel: async (sock) => {
            const currentSession = activePlaySessions.get(key);
            if (currentSession) {
                clearTimeout(currentSession.timer);
                if (currentSession.messageKey?.id && sock?.sendMessage) {
                    await sock
                        .sendMessage(session.chatJid, {
                            delete: currentSession.messageKey
                        })
                        .catch(() => {});
                }
                activePlaySessions.delete(key);
            }
            if (t) {
                return t('media.play.cancelled');
            }
            return 'YouTube music playback selection has been cancelled.';
        }
    });
}

/**
 * Retrieves the active play session for a user in a given chat, if present.
 */
export function getActivePlaySession(userJid: string, chatJid: string): PlaySession | undefined {
    if (!userJid || !chatJid) return undefined;
    const key = getSessionKey(userJid, chatJid);
    return activePlaySessions.get(key);
}

/**
 * Checks if a user has an active play session in a given chat.
 */
export function hasActivePlaySession(userJid: string, chatJid: string): boolean {
    return getActivePlaySession(userJid, chatJid) !== undefined;
}

/**
 * Clears an active play session and unregisters it from the cancellation manager.
 */
export function clearPlaySession(userJid: string, chatJid: string): boolean {
    const cleanUser = cleanId(userJid).toLowerCase();
    const cleanChat = cleanId(chatJid).toLowerCase();
    const key = getSessionKey(cleanUser, cleanChat);
    const session = activePlaySessions.get(key);
    if (session) {
        clearTimeout(session.timer);
        activePlaySessions.delete(key);
        unregisterCancellableSessionByUser(cleanUser, session.chatJid);
        unregisterCancellableSessionByUser(cleanUser, cleanChat);
        return true;
    }
    return false;
}

/**
 * Clears all active play sessions (used mainly for tests).
 */
export function clearAllPlaySessions(): void {
    for (const session of activePlaySessions.values()) {
        clearTimeout(session.timer);
        unregisterCancellableSessionByUser(session.userJid, session.chatJid);
    }
    activePlaySessions.clear();
}
