import { makeWASocket, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { handleMessage } from '#handlers/message.js';
import { cacheMessage, getCachedMessage, markMessageProcessed } from '#utils/messageCache.js';
import { usePrismaAuthState } from '#utils/prismaAuthState.js';
import { initActiveSessions } from '#utils/sessionStore.js';
import { dbContext, getPrismaClient, disconnectPrismaClient } from '#db.js';
import { updateUserPresence } from '#services/presenceService.js';
import { isAutoWhitelistEnabled, isAutoArchiveEnabled } from '#services/systemConfigService.js';
import { isFeatureEnabled } from '#services/subBotConfigService.js';
import { archiveChat, recordMessage } from '#services/chatArchiveService.js';
import { addGroup } from '#db.js';
import { cleanId } from '#utils/casino.js';
import { securityEnforcementService } from '#services/securityEnforcementService.js';

const logger = pino({ level: 'debug' });
const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY_MS = 3000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ConnectOptions {
    sessionId: string;
    phoneNumber?: string;
    pairingMethod?: 'code' | 'qr';
    onPairingCode?: (code: string) => void;
    onQRCode?: (qr: string) => void;
    onConnected?: () => void;
    onClosed?: (isLoggedOut: boolean) => void;
    disableReconnect?: boolean;
    isPairingMode?: boolean;
    isAborted?: () => boolean;
}

export const activeConnections = new Map<string, ReturnType<typeof makeWASocket>>();
export const stoppedSessions = new Set<string>();

export function stopConnection(sessionId: string): void {
    stoppedSessions.add(sessionId);
    const sock = activeConnections.get(sessionId);
    if (sock) {
        try {
            sock.end(undefined);
        } catch {
            /* ignore */
        }
    }
    activeConnections.delete(sessionId);
}

export async function connectToWhatsApp(options: ConnectOptions): Promise<void> {
    const { sessionId, phoneNumber, onPairingCode, onConnected, onClosed, isAborted } = options;
    let connectionOpenTimeSec = 0;
    let reconnectAttempts = 0;
    let presenceKeepAlive: NodeJS.Timeout | null = null;

    const authState = await usePrismaAuthState(sessionId);
    if (isAborted?.()) return;

    const { state, saveCreds } = authState;
    const { version } = await fetchLatestBaileysVersion();
    if (isAborted?.()) return;

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: logger as any,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        keepAliveIntervalMs: 15000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 15,
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            console.log(
                `[getMessage] [${sessionId}] Request received for key ID: ${key.id}, remoteJid: ${key.remoteJid}, fromMe: ${key.fromMe}`
            );
            try {
                if (key.id) {
                    const cached = getCachedMessage(key.id);
                    if (cached) {
                        console.log(`[getMessage] Found in cache for key ID: ${key.id}`);
                        return cached;
                    }
                }
            } catch (err) {
                console.error('Error in getMessage config:', err);
            }
            return undefined;
        }
    });

    if (isAborted?.()) {
        try {
            sock.end(undefined);
        } catch {
            /* ignore */
        }
        return;
    }

    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = (async (...args: Parameters<typeof originalSendMessage>) => {
        const result = await originalSendMessage(...args);
        if (result?.key?.id) {
            markMessageProcessed(result.key.id);
        }
        return result;
    }) as typeof sock.sendMessage;

    activeConnections.set(sessionId, sock);

    const isPairingMode = !!options.isPairingMode;
    const pendingPairing = isPairingMode && !sock.authState.creds.registered;
    let pairingRequested = false;

    if (pendingPairing) {
        if (!phoneNumber) {
            console.error(`[Pairing] [${sessionId}] No phone number provided for pairing`);
        } else {
            console.log(
                `[Pairing] [${sessionId}] Will request pairing code for ${phoneNumber} after WebSocket connects...`
            );
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`[Connection] [${sessionId}] Opened`);
            reconnectAttempts = 0;
            connectionOpenTimeSec = Math.floor(Date.now() / 1000);
            if (options.isPairingMode) {
                options.isPairingMode = false;
                options.isAborted = undefined;
            }
            if (sessionId === 'default') {
                await initActiveSessions();

                const { initAutoDelete } = await import('./autoDelete.js');
                initAutoDelete(sock);

                const { initRouletteAfkTimer } = await import('./rouletteAfkTimer.js');
                initRouletteAfkTimer(sock);

                const { startInflationCron } = await import('../services/inflation.js');
                startInflationCron(sock);
            }
            try {
                await sock.sendPresenceUpdate('available');
            } catch {
                /* ignore */
            }
            if (presenceKeepAlive) clearInterval(presenceKeepAlive);
            presenceKeepAlive = setInterval(() => {
                try {
                    sock.sendPresenceUpdate('available').catch(() => {});
                } catch {
                    /* ignore */
                }
            }, 60000);
            if (onConnected) onConnected();
        }
        if (update.qr && isPairingMode && !sock.authState.creds.registered) {
            if (options.pairingMethod === 'qr') {
                console.log(`[Pairing] [${sessionId}] Scan the QR code below with WhatsApp > Linked Devices:`);
                qrcode.generate(update.qr, { small: true });
                if (options.onQRCode) {
                    options.onQRCode(update.qr);
                }
            } else if (!pairingRequested && phoneNumber) {
                pairingRequested = true;
                try {
                    console.log(`[Pairing] [${sessionId}] Requesting pairing code for ${phoneNumber}...`);
                    await delay(3000); // Add delay to ensure notification is triggered
                    const code = await sock.requestPairingCode(phoneNumber);
                    const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;
                    if (onPairingCode) {
                        onPairingCode(formattedCode);
                    } else {
                        const msg = [
                            '',
                            '╔══════════════════════════════════════╗',
                            '║         PAIRING CODE                 ║',
                            `║     ${formattedCode.padEnd(34)}║`,
                            '╚══════════════════════════════════════╝',
                            '',
                            `[Pairing] [${sessionId}] Enter this code in WhatsApp > Linked Devices > Pair a device`,
                            ''
                        ].join('\n');
                        console.log(msg);
                        console.error(msg);
                    }
                } catch (err) {
                    console.error(`[Pairing] [${sessionId}] Failed to request pairing code:`, err);
                    pairingRequested = false;
                }
            }
        }
        if (connection === 'close') {
            const isManuallyStopped = stoppedSessions.has(sessionId);
            if (isManuallyStopped) {
                stoppedSessions.delete(sessionId);
            }

            const lastDisconnectError = lastDisconnect?.error as any;
            const errorCode = lastDisconnectError?.output?.statusCode || lastDisconnectError?.code;
            const errorMessage = lastDisconnectError?.message || 'Unknown Reason';
            const isConflict =
                errorCode === DisconnectReason.connectionReplaced ||
                (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('conflict'));
            const isLoggedOut = errorCode === DisconnectReason.loggedOut && !isConflict;
            const isPairedSuccess = !!sock.authState.creds.registered;

            if (isPairedSuccess) {
                options.isPairingMode = false;
                options.isAborted = undefined;
            }

            const shouldReconnect = isManuallyStopped
                ? false
                : isPairingMode
                  ? isPairedSuccess && !options.disableReconnect
                  : !isLoggedOut && !options.disableReconnect;

            console.log(
                `[Connection] [${sessionId}] Closed (Reason: ${errorMessage}, Code: ${errorCode}). Reconnecting: ${shouldReconnect}`
            );

            connectionOpenTimeSec = 0;
            if (presenceKeepAlive) {
                clearInterval(presenceKeepAlive);
                presenceKeepAlive = null;
            }
            activeConnections.delete(sessionId);

            if (lastDisconnect?.error) {
                console.error(`Connection close details [${sessionId}]: ${errorMessage}`, lastDisconnect.error);
            }

            if (isLoggedOut) {
                console.log(`[Connection] [${sessionId}] Logged out.`);
                if (sessionId === 'default') {
                    console.log(
                        `[Connection] [${sessionId}] Default bot logged out. Clearing credentials and exiting...`
                    );
                    try {
                        await getPrismaClient(sessionId).whatsAppAuth.deleteMany();
                    } catch (e) {
                        console.error('Failed to clear credentials', e);
                    }
                    process.exit(1);
                } else {
                    console.log(`[Connection] [${sessionId}] Sub-bot logged out. Dereferencing and cleaning up...`);
                    try {
                        await getPrismaClient(sessionId).whatsAppAuth.deleteMany();
                    } catch (e) {
                        console.error(`[${sessionId}] Error clearing whatsAppAuth:`, e);
                    }
                    try {
                        await disconnectPrismaClient(sessionId);
                    } catch (e) {
                        console.error(`[${sessionId}] Error disconnecting prisma:`, e);
                    }
                }
            } else if (isConflict) {
                console.warn(
                    `[Connection] [${sessionId}] Stream conflict detected (Code: ${errorCode}, Reason: ${errorMessage}). Retaining credentials.`
                );
            }

            if (onClosed) onClosed(isLoggedOut);

            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                if (!isPairedSuccess && isAborted?.()) {
                    console.log(`[Connection] [${sessionId}] Session aborted during pairing. Skipping reconnect.`);
                    return;
                }
                reconnectAttempts++;
                const reconnectDelay = RECONNECT_BASE_DELAY_MS * Math.min(reconnectAttempts, 5);
                console.log(
                    `[Connection] [${sessionId}] Reconnecting in ${reconnectDelay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
                );
                await delay(reconnectDelay);
                if (!isPairedSuccess && isAborted?.()) {
                    console.log(`[Connection] [${sessionId}] Session aborted during delay. Skipping reconnect.`);
                    return;
                }
                connectToWhatsApp(options);
            } else if (shouldReconnect) {
                console.error(
                    `[Connection] [${sessionId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
                );
            }
        }
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        if (options.isPairingMode && sock.authState?.creds?.registered) {
            console.log(`[Pairing] [${sessionId}] Device registration confirmed. Exiting pairing mode.`);
            options.isPairingMode = false;
            options.isAborted = undefined;
        }
    });

    const syncContacts = async (contacts: Partial<import('@whiskeysockets/baileys').Contact>[]) => {
        const sessionPrisma = getPrismaClient(sessionId);
        for (const contact of contacts) {
            if (!contact.id) continue;
            const waName = contact.notify?.trim() || contact.name?.trim() || null;
            const waUsername = contact.username?.trim() || null;
            if (!waName && !waUsername) continue;

            const cleanDigits = contact.id.split('@')[0].replace(/\D/g, '');
            const canonicalJid = cleanDigits ? `${cleanDigits}@s.whatsapp.net` : contact.id;

            try {
                const existing = await sessionPrisma.user.findFirst({
                    where: {
                        OR: [{ id: canonicalJid }, ...(cleanDigits ? [{ id: cleanDigits }] : [])]
                    }
                });

                if (existing) {
                    let newUsername = existing.username;
                    if (!newUsername || newUsername === existing.pushName) {
                        const candidate = waUsername || waName;
                        if (candidate) {
                            const collision = await sessionPrisma.user.findFirst({
                                where: { username: candidate, NOT: { id: existing.id } }
                            });
                            newUsername = collision
                                ? cleanDigits
                                    ? `${candidate}_${cleanDigits.slice(-4)}`
                                    : null
                                : candidate;
                        }
                    }

                    await sessionPrisma.user.update({
                        where: { id: existing.id },
                        data: {
                            ...(waName ? { pushName: waName } : {}),
                            ...(newUsername ? { username: newUsername } : {})
                        }
                    });
                }
            } catch {
                // Non-blocking sync for individual contact
            }
        }
    };

    sock.ev.on('messaging-history.set', async ({ contacts }) => {
        if (contacts && contacts.length > 0) {
            console.log(`[Connection] [${sessionId}] Received ${contacts.length} contacts via messaging-history.set`);
            await syncContacts(contacts);
        }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
        if (contacts && contacts.length > 0) {
            await syncContacts(contacts);
        }
    });

    sock.ev.on('contacts.update', async (updates) => {
        if (updates && updates.length > 0) {
            await syncContacts(updates);
        }
    });

    sock.ev.on('presence.update', ({ id, presences }) => {
        if (presences) {
            for (const [participant, presence] of Object.entries(presences)) {
                const target = participant || id;
                if (target && presence) {
                    updateUserPresence(target, presence.lastKnownPresence, (presence as any).lastSeen).catch(() => {});
                }
            }
        } else if (id) {
            updateUserPresence(id, 'available').catch(() => {});
        }
    });

    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
            if (action === 'add' && Array.isArray(participants) && id && id.endsWith('@g.us')) {
                const botId = cleanId(sock.user?.id);
                const botLid = cleanId((sock.user as Record<string, unknown> | undefined)?.lid as string | undefined);
                const isBotAdded = participants.some((p) => {
                    let pId = '';
                    if (typeof p === 'string') {
                        pId = p;
                    } else if (typeof p === 'object' && p !== null && 'id' in p && typeof p.id === 'string') {
                        pId = p.id;
                    }
                    const cleanP = cleanId(pId);
                    return cleanP === botId || (Boolean(botLid) && cleanP === botLid);
                });

                if (isBotAdded) {
                    if (isAutoWhitelistEnabled()) {
                        await addGroup(id, null);
                        console.log(
                            `[AutoWhitelist] [${sessionId}] Bot joined group ${id} - group automatically whitelisted.`
                        );
                    }

                    const isSubBot = sessionId.startsWith('sub_');
                    const subBotNumber = isSubBot ? sessionId.replace(/^sub_/, '') : undefined;
                    const shouldAutoArchive =
                        isSubBot && subBotNumber
                            ? isFeatureEnabled(subBotNumber, 'autoarchive') || isAutoArchiveEnabled()
                            : isAutoArchiveEnabled();

                    if (shouldAutoArchive) {
                        console.log(`[AutoArchive] [${sessionId}] Bot joined group ${id} - executing auto-archive.`);
                        archiveChat(sock, id).catch((archiveErr) => {
                            console.error(
                                `[AutoArchive] [${sessionId}] Failed to auto-archive group ${id}:`,
                                archiveErr
                            );
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[GroupParticipants] [${sessionId}] Error in group-participants.update handler:`, err);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`[DEBUG] [${sessionId}] messages.upsert type: ${type}, count: ${messages.length}`);
        for (const msg of messages) {
            const sender = msg.key?.participant || msg.key?.remoteJid;
            if (sender && securityEnforcementService.isBlacklisted(sender)) {
                continue;
            }
            recordMessage(msg);
            cacheMessage(msg);
        }
        if (type !== 'notify' && type !== 'append') return;
        for (const msg of messages) {
            try {
                const sender = msg.key?.participant || msg.key?.remoteJid;
                if (sender && securityEnforcementService.isBlacklisted(sender)) {
                    continue;
                }
                if (msg.key?.fromMe) {
                    console.log(
                        `[DEBUG_SELF_MSG] [${sessionId}] details:`,
                        JSON.stringify({
                            id: msg.key.id,
                            remoteJid: msg.key.remoteJid,
                            messageTimestamp: msg.messageTimestamp,
                            hasMessage: !!msg.message,
                            messageKeys: msg.message ? Object.keys(msg.message) : [],
                            text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
                        })
                    );
                }

                let msgTime: any = msg.messageTimestamp;
                if (msgTime && typeof msgTime === 'object' && typeof msgTime.toNumber === 'function') {
                    msgTime = msgTime.toNumber();
                } else if (msgTime && typeof msgTime === 'object') {
                    msgTime = Number(msgTime.low ?? msgTime.unsigned ?? 0);
                }
                msgTime = Number(msgTime || 0);

                if (msgTime > 0 && connectionOpenTimeSec > 0) {
                    if (msgTime < connectionOpenTimeSec - 2) {
                        continue;
                    }
                }

                await dbContext.run({ sessionId, prisma: getPrismaClient(sessionId) }, async () => {
                    await handleMessage(sock, msg);
                });
            } catch (error) {
                console.error(`[${sessionId}] Error handling message:`, error);
            }
        }
    });
}
