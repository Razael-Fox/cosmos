import { makeWASocket, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { getCachedMessage, markMessageProcessed } from '#lib/messageCache.js';
import { usePrismaAuthState } from '#lib/prismaAuthState.js';
import { registerEvents } from '#events/index.js';
import type { EventContext } from '#events/index.js';

const logger = pino({ level: 'debug' });

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
    const connectionOpenTimeSec = 0;
    const reconnectAttempts = 0;
    const presenceKeepAlive: NodeJS.Timeout | null = null;

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
    const pairingRequested = false;

    if (pendingPairing) {
        if (!phoneNumber) {
            console.error(`[Pairing] [${sessionId}] No phone number provided for pairing`);
        } else {
            console.log(
                `[Pairing] [${sessionId}] Will request pairing code for ${phoneNumber} after WebSocket connects...`
            );
        }
    }

    // All Baileys socket subscriptions live in `src/events/`, registered in the
    // same order as before. `ctx` carries the per-connection mutable state the
    // handlers read and write; nothing below reads these locals afterwards.
    const ctx: EventContext = {
        sessionId,
        options,
        phoneNumber,
        onPairingCode,
        onConnected,
        onClosed,
        isAborted,
        isPairingMode,
        pairingRequested,
        reconnectAttempts,
        connectionOpenTimeSec,
        presenceKeepAlive,
        saveCreds,
        reconnect: () => connectToWhatsApp(options),
        activeConnections,
        stoppedSessions
    };
    registerEvents(sock, ctx);
}
