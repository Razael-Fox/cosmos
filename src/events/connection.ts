import { DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { initActiveSessions } from '#lib/sessionStore.js';
import { getPrismaClient, disconnectPrismaClient } from '#db.js';
import { noteConnectionUpdate } from '#lib/runtimeHealth.js';
import type { EventContext, EventSocket } from './eventContext.js';

const MAX_RECONNECT_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY_MS = 3000;

/**
 * Fire-and-forget status notification helper. Uses a dynamic import so the
 * status notifier (which itself imports the connection lifecycle) never introduces a
 * circular static dependency into the Baileys connection lifecycle.
 *
 * Returns a promise that settles once delivery has been attempted, so
 * shutdown paths can await it with a bounded timeout before exiting.
 */
function emitConnectionStatus(
    event: 'BOT_DOWN' | 'BOT_RECONNECTED' | 'STATUS_DEGRADED',
    severity: 'INFO' | 'WARN' | 'CRITICAL',
    payload: { summary: string; details?: string[]; sessionId: string; dedupeWindowMs?: number }
): Promise<void> {
    return import('#services/notifier/notifier.js')
        .then(({ notify }) =>
            notify(
                event,
                severity,
                { summary: payload.summary, details: payload.details, sessionId: payload.sessionId },
                {
                    dedupeKey: `${event}:${payload.sessionId}`,
                    dedupeWindowMs: payload.dedupeWindowMs
                }
            )
        )
        .then(() => undefined)
        .catch((err) => {
            console.error('[Connection] Failed to emit status notification:', err);
        });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerConnectionEvents(sock: EventSocket, ctx: EventContext): void {
    const { sessionId, options, phoneNumber, onPairingCode, onConnected, onClosed, isAborted, saveCreds } = ctx;
    const isPairingMode = ctx.isPairingMode;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        // Surfaced through the IPC `/internal/bot/status` route and, in turn,
        // through the Cosmos MCP `cosmos_bot_status` tool.
        noteConnectionUpdate();

        if (connection === 'open') {
            console.log(`[Connection] [${sessionId}] Opened`);
            ctx.reconnectAttempts = 0;
            ctx.connectionOpenTimeSec = Math.floor(Date.now() / 1000);
            if (sessionId === 'default') {
                emitConnectionStatus('BOT_RECONNECTED', 'INFO', {
                    summary: 'The default WhatsApp session is connected.',
                    sessionId
                });
            }
            if (options.isPairingMode) {
                options.isPairingMode = false;
                options.isAborted = undefined;
            }
            if (sessionId === 'default') {
                await initActiveSessions();

                const { initAutoDelete } = await import('#lib/autoDelete.js');
                initAutoDelete(sock);

                const { startInflationCron } = await import('#services/inflation.js');
                startInflationCron(sock);
            }
            try {
                await sock.sendPresenceUpdate('available');
            } catch {
                /* ignore */
            }
            if (ctx.presenceKeepAlive) clearInterval(ctx.presenceKeepAlive);
            ctx.presenceKeepAlive = setInterval(() => {
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
            } else if (!ctx.pairingRequested && phoneNumber) {
                ctx.pairingRequested = true;
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
                    ctx.pairingRequested = false;
                }
            }
        }
        if (connection === 'close') {
            const isManuallyStopped = ctx.stoppedSessions.has(sessionId);
            if (isManuallyStopped) {
                ctx.stoppedSessions.delete(sessionId);
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

            ctx.connectionOpenTimeSec = 0;
            if (ctx.presenceKeepAlive) {
                clearInterval(ctx.presenceKeepAlive);
                ctx.presenceKeepAlive = null;
            }
            ctx.activeConnections.delete(sessionId);

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
                    // Await the shutdown alert with a bounded timeout so the
                    // most critical outage notification is not dropped by the
                    // exit below, while a stalled delivery cannot block restart.
                    await Promise.race([
                        emitConnectionStatus('BOT_DOWN', 'CRITICAL', {
                            summary:
                                'The default WhatsApp session logged out; credentials are being cleared and the process will exit for a supervised restart.',
                            details: [`Reason: ${errorMessage}`],
                            sessionId,
                            dedupeWindowMs: 60 * 60 * 1000
                        }),
                        delay(5000)
                    ]);
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

            if (shouldReconnect && ctx.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                if (!isPairedSuccess && isAborted?.()) {
                    console.log(`[Connection] [${sessionId}] Session aborted during pairing. Skipping reconnect.`);
                    return;
                }
                ctx.reconnectAttempts++;
                const reconnectDelay = RECONNECT_BASE_DELAY_MS * Math.min(ctx.reconnectAttempts, 5);
                console.log(
                    `[Connection] [${sessionId}] Reconnecting in ${reconnectDelay}ms (attempt ${ctx.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
                );
                if (sessionId === 'default') {
                    emitConnectionStatus('STATUS_DEGRADED', 'WARN', {
                        summary: `The default WhatsApp session dropped and is reconnecting (attempt ${ctx.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}).`,
                        details: [`Reason: ${errorMessage}`],
                        sessionId,
                        dedupeWindowMs: 30 * 60 * 1000
                    });
                }
                await delay(reconnectDelay);
                if (!isPairedSuccess && isAborted?.()) {
                    console.log(`[Connection] [${sessionId}] Session aborted during delay. Skipping reconnect.`);
                    return;
                }
                ctx.reconnect();
            } else if (shouldReconnect) {
                console.error(
                    `[Connection] [${sessionId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
                );
                if (sessionId === 'default') {
                    emitConnectionStatus('BOT_DOWN', 'CRITICAL', {
                        summary: `The default WhatsApp session exhausted ${MAX_RECONNECT_ATTEMPTS} reconnect attempts and gave up.`,
                        details: [`Reason: ${errorMessage}`, `Last status code: ${errorCode ?? 'unknown'}`],
                        sessionId,
                        dedupeWindowMs: 60 * 60 * 1000
                    });
                }
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
}
