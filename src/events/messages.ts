import { handleMessage } from '#handlers/message.js';
import { cacheMessage } from '#lib/messageCache.js';
import { dbContext, getPrismaClient } from '#db.js';
import { recordMessage } from '#services/chatArchiveService.js';
import { securityEnforcementService } from '#services/securityEnforcementService.js';
import type { EventContext, EventSocket } from './eventContext.js';

export function registerMessageEvents(sock: EventSocket, ctx: EventContext): void {
    const { sessionId } = ctx;

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

                if (msgTime > 0 && ctx.connectionOpenTimeSec > 0) {
                    if (msgTime < ctx.connectionOpenTimeSec - 2) {
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
