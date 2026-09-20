import axios from 'axios';
import { WASocket, proto, WAMessage } from '@whiskeysockets/baileys';
import { prisma } from '#db.js';
import { cleanId } from '#utils/casino.js';
import { unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
import { StickerlySearchResultItem, StickerlyPackDetails, getStickerPackDetails } from '#services/stickerlyService.js';
import {
    normalizeStickerBuffer,
    generateTrayIcon,
    buildWastickersZip,
    buildMmsZip,
    ProcessedSticker
} from './stickerPackBuilder.js';
import { uploadStickerPackMedia, sendNativeStickerPackMessage } from './stickerPackUploader.js';

export interface StickerlySession {
    chatJid: string;
    userJid: string;
    query: string;
    packs: StickerlySearchResultItem[];
    previewMessageKeys: proto.IMessageKey[];
    guideMessageKey?: proto.IMessageKey;
    timer: NodeJS.Timeout;
}

const activeStickerlySessions = new Map<string, StickerlySession>();

function getSessionKey(userJid: string, chatJid: string): string {
    const cleanUser = cleanId(userJid).toLowerCase();
    const cleanChat = cleanId(chatJid).toLowerCase();
    return `${cleanUser}:${cleanChat}`;
}

export function registerStickerlySession(session: StickerlySession): void {
    const key = getSessionKey(session.userJid, session.chatJid);
    activeStickerlySessions.set(key, session);
}

export function getStickerlySession(arg1: string, arg2?: string): StickerlySession | undefined {
    if (!arg1) return undefined;
    const clean1 = cleanId(arg1).toLowerCase();
    const clean2 = arg2 ? cleanId(arg2).toLowerCase() : undefined;

    // 1. Try exact composite keys in either order
    if (clean2) {
        const s1 = activeStickerlySessions.get(`${clean1}:${clean2}`);
        if (s1) return s1;
        const s2 = activeStickerlySessions.get(`${clean2}:${clean1}`);
        if (s2) return s2;
    }

    // 2. Match by chat JID
    for (const session of activeStickerlySessions.values()) {
        const sc = cleanId(session.chatJid).toLowerCase();
        if (sc === clean1 || (clean2 && sc === clean2)) {
            return session;
        }
    }

    return undefined;
}

export function hasActiveStickerlySession(arg1: string, arg2?: string): boolean {
    return getStickerlySession(arg1, arg2) !== undefined;
}

export function deleteStickerlySession(arg1: string, arg2?: string): boolean {
    if (!arg1) return false;
    const clean1 = cleanId(arg1).toLowerCase();
    const clean2 = arg2 ? cleanId(arg2).toLowerCase() : undefined;

    let deleted = false;
    for (const [k, session] of activeStickerlySessions.entries()) {
        const sc = cleanId(session.chatJid).toLowerCase();
        const su = cleanId(session.userJid).toLowerCase();
        if (
            (sc === clean1 && (!clean2 || su === clean2)) ||
            (sc === clean2 && su === clean1) ||
            (clean2 && (k === `${clean1}:${clean2}` || k === `${clean2}:${clean1}`)) ||
            (!clean2 && (sc === clean1 || su === clean1))
        ) {
            activeStickerlySessions.delete(k);
            deleted = true;
        }
    }
    return deleted;
}

/**
 * Batch deletes messages for everyone via Promise.allSettled.
 */
export async function deletePreviewMessages(sock: WASocket, chatJid: string, keys: proto.IMessageKey[]): Promise<void> {
    if (!keys || keys.length === 0) return;
    await Promise.allSettled(keys.map((key) => sock.sendMessage(chatJid, { delete: key })));
}

/**
 * Schedules a message ID for deletion in Prisma SQLite ScheduledDeletion table.
 */
export async function scheduleMessageDeletion(
    jid: string,
    msgId: string,
    fromMe = true,
    delayMs = 120 * 1000
): Promise<void> {
    const deleteAt = new Date(Date.now() + delayMs);
    try {
        await prisma.scheduledDeletion.upsert({
            where: {
                jid_msgId: {
                    jid,
                    msgId
                }
            },
            update: {
                deleteAt,
                fromMe
            },
            create: {
                jid,
                msgId,
                fromMe,
                deleteAt
            }
        });
    } catch (err) {
        console.error('[Stickerly] Failed to schedule message deletion:', err);
    }
}

/**
 * Removes scheduled message deletions from Prisma SQLite ScheduledDeletion table.
 */
export async function removeScheduledDeletions(jid: string, msgIds: string[]): Promise<void> {
    if (!msgIds || msgIds.length === 0) return;
    try {
        await prisma.scheduledDeletion.deleteMany({
            where: {
                jid,
                msgId: { in: msgIds }
            }
        });
    } catch (err) {
        console.error('[Stickerly] Failed to remove scheduled deletions:', err);
    }
}

/**
 * Executes async mapping with a concurrency limit.
 */
async function pMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (index < items.length) {
            const currentIndex = index++;
            results[currentIndex] = await fn(items[currentIndex], currentIndex);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Processes complete sticker pack generation, packaging, and delivery.
 */
export async function processStickerPackMaker(
    sock: WASocket,
    chatJid: string,
    packTarget: StickerlySearchResultItem | StickerlyPackDetails,
    progressMsgKey: proto.IMessageKey | undefined,
    t: (key: string, opts?: any) => string
): Promise<void> {
    try {
        const packDetails: StickerlyPackDetails =
            'resourceUrlPrefix' in packTarget && Array.isArray(packTarget.stickers)
                ? packTarget
                : await getStickerPackDetails(packTarget.packId);

        if (!packDetails.stickers || packDetails.stickers.length === 0) {
            throw new Error('Sticker pack contains no stickers.');
        }

        // WhatsApp rejects sticker packs with > 60 stickers
        const targetStickers = packDetails.stickers.slice(0, 60);

        // Download and normalize stickers concurrently (max 5 parallel streams)
        const processedStickers = await pMap(
            targetStickers,
            5,
            async (stickerItem, index): Promise<ProcessedSticker | null> => {
                const downloadUrl = `${packDetails.resourceUrlPrefix}${stickerItem.fileName}`;
                try {
                    const response = await axios.get(downloadUrl, {
                        responseType: 'arraybuffer',
                        timeout: 20000
                    });
                    const rawBuffer = Buffer.from(response.data);
                    const normalizedBuffer = await normalizeStickerBuffer(rawBuffer, stickerItem.isAnimated);

                    return {
                        buffer: normalizedBuffer,
                        isAnimated: stickerItem.isAnimated,
                        emojis:
                            Array.isArray(stickerItem.tags) && stickerItem.tags.length > 0 ? stickerItem.tags : ['✨']
                    };
                } catch (dlErr) {
                    console.error(`[Stickerly] Failed to download sticker #${index + 1} (${downloadUrl}):`, dlErr);
                    return null;
                }
            }
        );

        const validStickers = processedStickers.filter((s): s is ProcessedSticker => s !== null);
        if (validStickers.length === 0) {
            throw new Error('Failed to download any stickers from the pack.');
        }

        // Generate tray icon (252x252 PNG) from first sticker
        const trayPngBuffer = await generateTrayIcon(validStickers[0].buffer);

        // Build containers: MMS ZIP and companion .wastickers ZIP
        const mmsZip = buildMmsZip(packDetails, validStickers, trayPngBuffer);
        const wastickersZip = buildWastickersZip(packDetails, validStickers, trayPngBuffer);

        // Tier 1: Deliver native WhatsApp StickerPack card
        try {
            const uploadResult = await uploadStickerPackMedia(sock, mmsZip.zipBuffer);
            await sendNativeStickerPackMessage(
                sock,
                chatJid,
                packDetails,
                uploadResult,
                mmsZip.stickersList,
                mmsZip.trayFileName
            );
            console.log(`[Stickerly] Successfully relayed native stickerPackMessage for "${packDetails.name}"`);
        } catch (mmsErr) {
            console.warn('[Stickerly] Native sticker pack upload failed, continuing with .wastickers:', mmsErr);
        }

        // Tier 2: Deliver companion .wastickers document file
        const cleanPackName = packDetails.name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'sticker_pack';
        await sock.sendMessage(chatJid, {
            document: wastickersZip,
            fileName: `${cleanPackName}.wastickers`,
            mimetype: 'application/octet-stream',
            caption: t('media.stickerly.wastickers_caption', {
                name: packDetails.name,
                count: validStickers.length
            })
        });

        // Delete progress message if exists
        if (progressMsgKey) {
            await sock.sendMessage(chatJid, { delete: progressMsgKey }).catch(() => {});
        }
    } catch (err: any) {
        console.error('[Stickerly] Error during sticker pack maker execution:', err);
        const errorMsg = t('media.stickerly.error_process_pack', {
            error: err?.message || 'Unknown error'
        });
        await sock.sendMessage(chatJid, { text: `❌ ${errorMsg}` });
        if (progressMsgKey) {
            await sock.sendMessage(chatJid, { delete: progressMsgKey }).catch(() => {});
        }
    }
}

/**
 * Intercepts incoming messages to detect pack selection via quoted preview or number 1-5.
 */
export async function processStickerlySelection(
    sock: WASocket,
    msg: WAMessage,
    userJid: string,
    chatJid: string,
    text: string,
    t: (key: string, opts?: any) => string
): Promise<boolean> {
    const session = getStickerlySession(chatJid, userJid);
    if (!session) return false;

    let selectedPack: StickerlySearchResultItem | null = null;

    // Check context info for quoted preview messages
    const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo;
    const quotedStanzaId = contextInfo?.stanzaId;

    // 1. Check if the user quoted one of the 5 preview messages by stanzaId
    if (quotedStanzaId) {
        const matchIdx = session.previewMessageKeys.findIndex((k) => k.id === quotedStanzaId);
        if (matchIdx !== -1 && session.packs[matchIdx]) {
            selectedPack = session.packs[matchIdx];
        }
    }

    // 2. Check if quoted message caption or text contains STICKER PACK #N / PAKET STIKER #N
    if (!selectedPack && contextInfo?.quotedMessage) {
        const qm = contextInfo.quotedMessage;
        const quotedCaption =
            qm.imageMessage?.caption ||
            qm.videoMessage?.caption ||
            qm.conversation ||
            qm.extendedTextMessage?.text ||
            '';
        const cardMatch = quotedCaption.match(/(?:STICKER PACK|PAKET STIKER)\s*#(\d+)/i);
        if (cardMatch) {
            const num = parseInt(cardMatch[1], 10);
            if (num >= 1 && num <= session.packs.length) {
                selectedPack = session.packs[num - 1];
            }
        }
    }

    // 3. Check if the user typed a number (1 - 5), #1 - #5, pack 1-5, or similar
    if (!selectedPack) {
        const trimmed = text.trim();
        const numMatch = trimmed.match(/^(?:#|pack\s*|paket\s*|nomor\s*|no\.?\s*|pilih\s*)?([1-5])$/i);
        if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (num >= 1 && num <= session.packs.length) {
                selectedPack = session.packs[num - 1];
            }
        }
    }

    if (!selectedPack) {
        return false;
    }

    // Clear session timeout timer
    clearTimeout(session.timer);
    unregisterCancellableSessionByUser(session.userJid, session.chatJid);
    unregisterCancellableSessionByUser(userJid, chatJid);

    // Collect all preview keys and guide key
    const allKeysToDelete = [...session.previewMessageKeys];
    if (session.guideMessageKey) {
        allKeysToDelete.push(session.guideMessageKey);
    }

    // IMMEDIATELY delete all preview messages and guide message for everyone
    await deletePreviewMessages(sock, chatJid, allKeysToDelete);
    await removeScheduledDeletions(chatJid, allKeysToDelete.map((k) => k.id!).filter(Boolean));
    deleteStickerlySession(session.chatJid);
    deleteStickerlySession(chatJid);

    // Send immediate progress notification
    const progressText = t('media.stickerly.processing', {
        name: selectedPack.name,
        count: selectedPack.stickers
    });
    const progressMsg = await sock.sendMessage(chatJid, {
        text: `⏳ ${progressText}`
    });

    // Launch Sticker Pack Maker pipeline without extra confirmation prompts
    await processStickerPackMaker(sock, chatJid, selectedPack, progressMsg?.key, t);

    return true;
}
