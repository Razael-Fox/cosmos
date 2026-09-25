import { WASocket, WAMessage, ChatModification, jidNormalizedUser, proto } from '@whiskeysockets/baileys';

export interface ChatLastMessage {
    key: {
        remoteJid: string;
        id: string;
        fromMe: boolean;
        participant?: string;
    };
    messageTimestamp: number;
}

const MAX_CACHE_SIZE = 1000;
const lastMessagesByChat = new Map<string, ChatLastMessage>();
const pendingWaiters = new Map<string, Array<(msg: ChatLastMessage) => void>>();

/**
 * Normalizes JID to standard format.
 */
function cleanJid(jid?: string | null): string {
    if (!jid) return '';
    return jid.trim();
}

/**
 * Record a message as the latest message for a chat.
 * Resolves any pending callers waiting for an incoming message in that chat.
 */
export function recordMessage(msg: WAMessage): void {
    if (!msg.key?.remoteJid || !msg.key?.id) return;

    const remoteJid = cleanJid(msg.key.remoteJid);
    if (!remoteJid) return;

    let timestamp: number;
    if (typeof msg.messageTimestamp === 'number') {
        timestamp = msg.messageTimestamp;
    } else if (msg.messageTimestamp) {
        timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
    } else {
        timestamp = Math.floor(Date.now() / 1000);
    }

    const isGroup = remoteJid.endsWith('@g.us');
    let participant: string | undefined;

    if (isGroup && !msg.key.fromMe) {
        let rawPart = msg.key.participant;
        if (!rawPart && 'participant' in msg && typeof msg.participant === 'string') {
            rawPart = msg.participant;
        }
        if (rawPart) {
            participant = jidNormalizedUser(rawPart);
        }
    }

    const record: ChatLastMessage = {
        key: {
            remoteJid,
            id: msg.key.id,
            fromMe: Boolean(msg.key.fromMe),
            ...(participant ? { participant } : {})
        },
        messageTimestamp: timestamp
    };

    lastMessagesByChat.set(remoteJid, record);

    // Enforce cache bounds with FIFO eviction
    if (lastMessagesByChat.size > MAX_CACHE_SIZE) {
        const firstKey = lastMessagesByChat.keys().next().value;
        if (firstKey) {
            lastMessagesByChat.delete(firstKey);
        }
    }

    // Resolve any pending waiters
    const waiters = pendingWaiters.get(remoteJid);
    if (waiters && waiters.length > 0) {
        pendingWaiters.delete(remoteJid);
        for (const resolve of waiters) {
            try {
                resolve(record);
            } catch {
                /* ignore waiter callback error */
            }
        }
    }
}

/**
 * Retrieve the last recorded message for a specific chat JID.
 */
export function getLastMessage(jid: string): ChatLastMessage | undefined {
    const target = cleanJid(jid);
    return lastMessagesByChat.get(target);
}

/**
 * Wait up to timeoutMs for the latest message of a chat to arrive via messages.upsert.
 */
export function waitForLastMessage(jid: string, timeoutMs: number = 2500): Promise<ChatLastMessage | null> {
    const target = cleanJid(jid);
    const existing = lastMessagesByChat.get(target);
    if (existing) {
        return Promise.resolve(existing);
    }

    return new Promise<ChatLastMessage | null>((resolve) => {
        const timer: NodeJS.Timeout = setTimeout(
            () => {
                const currentList = pendingWaiters.get(target);
                if (currentList) {
                    const filtered = currentList.filter((cb) => cb !== waiter);
                    if (filtered.length > 0) {
                        pendingWaiters.set(target, filtered);
                    } else {
                        pendingWaiters.delete(target);
                    }
                }
                // Check once more in case it arrived just before timeout
                resolve(lastMessagesByChat.get(target) || null);
            },
            Math.max(100, timeoutMs)
        );

        const waiter = (msg: ChatLastMessage) => {
            clearTimeout(timer);
            resolve(msg);
        };

        const existingList = pendingWaiters.get(target) || [];
        existingList.push(waiter);
        pendingWaiters.set(target, existingList);
    });
}

/**
 * Safely archive a chat using Baileys chatModify.
 * Ensures compliance with WhatsApp MD sync requirements to prevent de-authentication.
 */
export async function archiveChat(
    sock: WASocket,
    jid: string,
    options?: {
        timeoutMs?: number;
        lastMessage?: ChatLastMessage;
    }
): Promise<boolean> {
    const targetJid = cleanJid(jid);
    if (!targetJid) {
        console.warn('[AutoArchive] Invalid target JID provided for archiving.');
        return false;
    }

    try {
        let lastMsg = options?.lastMessage;
        if (!lastMsg) {
            lastMsg = (await waitForLastMessage(targetJid, options?.timeoutMs ?? 2000)) || getLastMessage(targetJid);
        }

        const isGroup = targetJid.endsWith('@g.us');
        let modificationPayload: ChatModification;

        if (lastMsg && lastMsg.key?.id && lastMsg.messageTimestamp) {
            const hasValidParticipant = !isGroup || lastMsg.key.fromMe || Boolean(lastMsg.key.participant);
            if (hasValidParticipant) {
                modificationPayload = {
                    archive: true,
                    lastMessages: [
                        {
                            key: {
                                remoteJid: targetJid,
                                id: lastMsg.key.id,
                                fromMe: Boolean(lastMsg.key.fromMe),
                                ...(lastMsg.key.participant ? { participant: lastMsg.key.participant } : {})
                            },
                            messageTimestamp: lastMsg.messageTimestamp
                        }
                    ]
                };
            } else {
                // If group message without participant info, pass messageRange object to prevent Boom exception
                const messageRange: proto.SyncActionValue.ISyncActionMessageRange = {
                    lastMessageTimestamp: lastMsg.messageTimestamp
                };
                modificationPayload = {
                    archive: true,
                    lastMessages: messageRange
                };
            }
        } else {
            // Fallback when no recent message was observed within timeout window
            const messageRange: proto.SyncActionValue.ISyncActionMessageRange = {
                lastMessageTimestamp: Math.floor(Date.now() / 1000)
            };
            modificationPayload = {
                archive: true,
                lastMessages: messageRange
            };
        }

        await sock.chatModify(modificationPayload, targetJid);
        console.log(`[AutoArchive] Successfully archived chat ${targetJid}.`);
        return true;
    } catch (err) {
        console.error(`[AutoArchive] Failed to archive chat ${targetJid}:`, err);
        return false;
    }
}

/**
 * Safely unarchive a chat using Baileys chatModify.
 */
export async function unarchiveChat(
    sock: WASocket,
    jid: string,
    options?: {
        timeoutMs?: number;
        lastMessage?: ChatLastMessage;
    }
): Promise<boolean> {
    const targetJid = cleanJid(jid);
    if (!targetJid) {
        console.warn('[AutoArchive] Invalid target JID provided for unarchiving.');
        return false;
    }

    try {
        let lastMsg = options?.lastMessage;
        if (!lastMsg) {
            lastMsg = (await waitForLastMessage(targetJid, options?.timeoutMs ?? 2000)) || getLastMessage(targetJid);
        }

        const isGroup = targetJid.endsWith('@g.us');
        let modificationPayload: ChatModification;

        if (lastMsg && lastMsg.key?.id && lastMsg.messageTimestamp) {
            const hasValidParticipant = !isGroup || lastMsg.key.fromMe || Boolean(lastMsg.key.participant);
            if (hasValidParticipant) {
                modificationPayload = {
                    archive: false,
                    lastMessages: [
                        {
                            key: {
                                remoteJid: targetJid,
                                id: lastMsg.key.id,
                                fromMe: Boolean(lastMsg.key.fromMe),
                                ...(lastMsg.key.participant ? { participant: lastMsg.key.participant } : {})
                            },
                            messageTimestamp: lastMsg.messageTimestamp
                        }
                    ]
                };
            } else {
                const messageRange: proto.SyncActionValue.ISyncActionMessageRange = {
                    lastMessageTimestamp: lastMsg.messageTimestamp
                };
                modificationPayload = {
                    archive: false,
                    lastMessages: messageRange
                };
            }
        } else {
            const messageRange: proto.SyncActionValue.ISyncActionMessageRange = {
                lastMessageTimestamp: Math.floor(Date.now() / 1000)
            };
            modificationPayload = {
                archive: false,
                lastMessages: messageRange
            };
        }

        await sock.chatModify(modificationPayload, targetJid);
        console.log(`[AutoArchive] Successfully unarchived chat ${targetJid}.`);
        return true;
    } catch (err) {
        console.error(`[AutoArchive] Failed to unarchive chat ${targetJid}:`, err);
        return false;
    }
}

/**
 * Clear in-memory caches and waiters (primarily for testing purposes).
 */
export function clearChatArchiveCache(): void {
    lastMessagesByChat.clear();
    pendingWaiters.clear();
}
