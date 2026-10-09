import { WASocket, proto } from '@whiskeysockets/baileys';
import { isAutoDlEnabled } from './autodl.js';
import { prisma } from '#db.js';

let cleanupInterval: NodeJS.Timeout | null = null;
let currentSock: WASocket | null = null;

export function initAutoDelete(sock: WASocket) {
    currentSock = sock;
    if (cleanupInterval) clearInterval(cleanupInterval);

    // Check database every 30 seconds for expired messages
    cleanupInterval = setInterval(processDeletionQueue, 30 * 1000);
    processDeletionQueue(); // run immediately on startup
}

export async function scheduleMediaAutoDelete(
    sock: WASocket,
    jid: string,
    sentMsg: any,
    mediaType: 'image' | 'video' | 'audio'
) {
    if (!sentMsg || !sentMsg.key) return;

    if (!isAutoDlEnabled(jid, 'autodelete')) return;

    let delayMs = 0;
    if (mediaType === 'image') delayMs = 30 * 60 * 1000;
    else if (mediaType === 'video') delayMs = 20 * 60 * 1000;
    else if (mediaType === 'audio') delayMs = 5 * 60 * 1000;

    if (delayMs === 0) return;

    const deleteAt = new Date(Date.now() + delayMs);

    try {
        await prisma.scheduledDeletion.upsert({
            where: {
                jid_msgId: {
                    jid: jid,
                    msgId: sentMsg.key.id!
                }
            },
            update: {
                deleteAt,
                fromMe: sentMsg.key.fromMe ?? true
            },
            create: {
                jid,
                msgId: sentMsg.key.id!,
                fromMe: sentMsg.key.fromMe ?? true,
                deleteAt
            }
        });
        console.log(`[AutoDelete] Scheduled ${mediaType} deletion for ${sentMsg.key.id} at ${deleteAt.toISOString()}`);
    } catch (err) {
        console.error('[AutoDelete] Failed to schedule deletion:', err);
    }
}

async function processDeletionQueue() {
    if (!currentSock) return;

    try {
        const now = new Date();
        const pending = await prisma.scheduledDeletion.findMany({
            where: {
                deleteAt: {
                    lte: now
                }
            }
        });

        for (const task of pending) {
            try {
                await currentSock.sendMessage(task.jid, {
                    delete: { remoteJid: task.jid, fromMe: task.fromMe, id: task.msgId }
                });
                console.log(`[AutoDelete] Deleted media message ${task.msgId} in ${task.jid}`);

                await prisma.scheduledDeletion.delete({
                    where: { id: task.id }
                });
            } catch (err) {
                console.error(`[AutoDelete] Failed to delete media message ${task.msgId}`, err);
                // Optionally delete it from DB if it fails repeatedly, but for now we just keep trying or let it be.
                // Wait, if it fails, we should delete it from DB to avoid infinite loops
                await prisma.scheduledDeletion
                    .delete({
                        where: { id: task.id }
                    })
                    .catch(() => {});
            }
        }
    } catch (err) {
        console.error('[AutoDelete] Error processing queue:', err);
    }
}

export async function deleteSenderLink(sock: WASocket, jid: string, msgKey: proto.IMessageKey) {
    if (!isAutoDlEnabled(jid, 'autodelete')) return;

    try {
        if (msgKey.fromMe) {
            await sock.sendMessage(jid, { delete: msgKey });
        } else {
            if (jid.endsWith('@g.us')) {
                const groupMetadata = await sock.groupMetadata(jid);
                const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                const botParticipant = groupMetadata.participants.find((p) => p.id === botJid);

                const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

                if (isBotAdmin) {
                    await sock.sendMessage(jid, { delete: msgKey });
                } else {
                    await sock.chatModify(
                        {
                            deleteForMe: {
                                deleteMedia: false,
                                key: msgKey,
                                timestamp: Date.now()
                            }
                        },
                        jid
                    );
                }
            } else {
                await sock.chatModify(
                    {
                        deleteForMe: {
                            deleteMedia: false,
                            key: msgKey,
                            timestamp: Date.now()
                        }
                    },
                    jid
                );
            }
        }
        console.log(`[AutoDelete] Deleted sender link message ${msgKey.id} in ${jid}`);
    } catch (error) {
        console.error(`[AutoDelete] Failed to delete sender link ${msgKey.id}`, error);
    }
}
