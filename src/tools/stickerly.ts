import { ToolDefinition, ToolContext } from './types.js';
import { cleanId } from '#utils/casino.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
import {
    searchStickerly,
    extractStickerlyPackId,
    getStickerPackDetails,
    fetchAndNormalizeThumbnail
} from '#services/stickerlyService.js';
import {
    StickerlySession,
    registerStickerlySession,
    hasActiveStickerlySession,
    getStickerlySession,
    deleteStickerlySession,
    deletePreviewMessages,
    scheduleMessageDeletion,
    removeScheduledDeletions,
    processStickerPackMaker
} from '#utils/stickerlySession.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const definition: ToolDefinition = {
    name: 'stickerly',
    title: 'Sticker.ly Pack Search & Export',
    category: 'Media & Stickers',
    aliases: ['.stickerly', '.spack', '.stickerpack'],
    description: 'Search for sticker packs on Sticker.ly and export them to WhatsApp.',
    descriptionKey: 'tools.commands.stickerly.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search keyword or direct Sticker.ly pack URL.'
            }
        },
        required: ['query']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const rawQuery = args.query ? String(args.query).trim() : '';
    const senderCandidate = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const senderRaw = cleanId(senderCandidate) || '';

    if (!rawQuery) {
        return ctx.t('media.stickerly.usage');
    }

    if (hasActiveStickerlySession(senderRaw, ctx.jid)) {
        return ctx.t('media.stickerly.already_active');
    }

    // Direct Sticker.ly URL handling (e.g. https://sticker.ly/s/OD5GZR)
    if (rawQuery.includes('sticker.ly')) {
        const directPackId = extractStickerlyPackId(rawQuery);
        if (directPackId) {
            try {
                const packDetails = await getStickerPackDetails(directPackId);
                const progressMsg = await ctx.sock.sendMessage(ctx.jid, {
                    text: `⏳ ${ctx.t('media.stickerly.processing', {
                        name: packDetails.name,
                        count: packDetails.stickers.length
                    })}`
                });
                await processStickerPackMaker(ctx.sock, ctx.jid, packDetails, progressMsg?.key, ctx.t);
                return;
            } catch (err: any) {
                console.error('[Stickerly] Direct pack fetch error:', err);
                return `❌ ${ctx.t('media.stickerly.error_fetch_pack', {
                    error: err?.message || ctx.t('core.unknown_error')
                })}`;
            }
        }
    }

    // Search Sticker.ly via Dongtube API
    let searchResults;
    try {
        searchResults = await searchStickerly(rawQuery);
    } catch (err: any) {
        if (err?.message === 'DONGTUBE_API_KEY_MISSING') {
            return `❌ ${ctx.t('media.stickerly.error_api_key')}`;
        }
        console.error('[Stickerly] Search API error:', err?.message || 'Unknown error');
        return `❌ ${ctx.t('media.stickerly.error_search', {
            error: err?.message || ctx.t('core.unknown_error')
        })}`;
    }

    if (!searchResults || searchResults.length === 0) {
        // Fallback: check if the query was a standalone 6-char pack ID (e.g. OD5GZR)
        const directPackId = extractStickerlyPackId(rawQuery);
        if (directPackId) {
            try {
                const packDetails = await getStickerPackDetails(directPackId);
                const progressMsg = await ctx.sock.sendMessage(ctx.jid, {
                    text: `⏳ ${ctx.t('media.stickerly.processing', {
                        name: packDetails.name,
                        count: packDetails.stickers.length
                    })}`
                });
                await processStickerPackMaker(ctx.sock, ctx.jid, packDetails, progressMsg?.key, ctx.t);
                return;
            } catch {
                // Fall through to no_results
            }
        }
        return ctx.t('media.stickerly.no_results', { query: rawQuery });
    }

    const session: StickerlySession = {
        chatJid: ctx.jid,
        userJid: senderRaw,
        query: rawQuery,
        packs: searchResults,
        previewMessageKeys: [],
        timer: null as any
    };

    // Send 5 separate sequential preview messages with native media attachments (NO externalAdReply)
    for (let i = 0; i < searchResults.length; i++) {
        const pack = searchResults[i];
        const caption =
            `${ctx.t('media.stickerly.card_header', { number: i + 1 })}\n` +
            `📦 *${ctx.t('media.stickerly.label_title')}:* ${pack.name}\n` +
            `👤 *${ctx.t('media.stickerly.label_author')}:* ${pack.author}\n` +
            `🔢 *${ctx.t('media.stickerly.label_stickers')}:* ${pack.stickers}\n` +
            `👁️ *${ctx.t('media.stickerly.label_views')}:* ${pack.views}\n` +
            `📥 *${ctx.t('media.stickerly.label_exports')}:* ${pack.exports}\n` +
            `✨ *${ctx.t('media.stickerly.label_type')}:* ${pack.animated ? ctx.t('media.stickerly.value_animated') : ctx.t('media.stickerly.value_static')}`;

        try {
            const thumb = await fetchAndNormalizeThumbnail(pack.thumbnail, pack.animated);
            let sentMsg;

            if (thumb.type === 'video') {
                sentMsg = await ctx.sock.sendMessage(ctx.jid, {
                    video: thumb.buffer,
                    gifPlayback: true,
                    caption
                });
            } else {
                sentMsg = await ctx.sock.sendMessage(ctx.jid, {
                    image: thumb.buffer,
                    caption
                });
            }

            if (sentMsg?.key) {
                session.previewMessageKeys.push(sentMsg.key);
                await scheduleMessageDeletion(ctx.jid, sentMsg.key.id!, sentMsg.key.fromMe ?? true, 120 * 1000);
            }
        } catch (thumbErr) {
            console.error(`[Stickerly] Failed to send preview for pack #${i + 1}:`, thumbErr);
            // Fallback to text card if thumbnail fails
            const sentMsg = await ctx.sock.sendMessage(ctx.jid, { text: caption });
            if (sentMsg?.key) {
                session.previewMessageKeys.push(sentMsg.key);
                await scheduleMessageDeletion(ctx.jid, sentMsg.key.id!, sentMsg.key.fromMe ?? true, 120 * 1000);
            }
        }

        // Pacing delay between preview messages (250ms - 350ms)
        await sleep(300);
    }

    // Dispatch navigation guide message
    const guideText =
        `${ctx.t('media.stickerly.guide_title', { query: rawQuery })}\n\n` +
        `${ctx.t('media.stickerly.guide_instruction', { count: searchResults.length })}`;

    const guideMsg = await ctx.sock.sendMessage(ctx.jid, { text: guideText });
    if (guideMsg?.key) {
        session.guideMessageKey = guideMsg.key;
        await scheduleMessageDeletion(ctx.jid, guideMsg.key.id!, guideMsg.key.fromMe ?? true, 120 * 1000);
    }

    // Set 2-minute auto-expiry timer
    session.timer = setTimeout(async () => {
        try {
            const allKeys = [...session.previewMessageKeys];
            if (session.guideMessageKey) {
                allKeys.push(session.guideMessageKey);
            }
            await deletePreviewMessages(ctx.sock, ctx.jid, allKeys);
            await removeScheduledDeletions(ctx.jid, allKeys.map((k) => k.id!).filter(Boolean));
            deleteStickerlySession(senderRaw, ctx.jid);
            unregisterCancellableSessionByUser(senderRaw, ctx.jid);
        } catch (cleanupErr) {
            console.error('[Stickerly] Error during session timeout cleanup:', cleanupErr);
        }
    }, 120 * 1000);

    registerStickerlySession(session);

    // Register with global cancellation system (.cancel)
    registerCancellableSession({
        sessionId: `stickerly_${senderRaw}_${cleanId(ctx.jid)}`,
        feature: 'stickerly',
        userJid: senderRaw,
        chatJid: ctx.jid,
        description: ctx.t('media.stickerly.cancellation_desc', { query: rawQuery }),
        onCancel: async (sock) => {
            const currentSession = getStickerlySession(senderRaw, ctx.jid);
            if (currentSession) {
                clearTimeout(currentSession.timer);
                const allKeys = [...currentSession.previewMessageKeys];
                if (currentSession.guideMessageKey) {
                    allKeys.push(currentSession.guideMessageKey);
                }
                await deletePreviewMessages(sock, ctx.jid, allKeys);
                await removeScheduledDeletions(ctx.jid, allKeys.map((k) => k.id!).filter(Boolean));
                deleteStickerlySession(senderRaw, ctx.jid);
            }
            return ctx.t('media.stickerly.cancelled');
        }
    });

    return;
}
