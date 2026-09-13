import { ToolDefinition, ToolContext } from './types.js';
import { downloadContentFromMessage, jidNormalizedUser } from '@whiskeysockets/baileys';

export const definition: ToolDefinition = {
    name: 'rvo',
    title: 'Read View Once',
    category: 'Tools & Utilities',
    aliases: ['readviewonce', 'openviewonce'],
    description:
        'Reveals a view-once media message (image, video, or voice note) and resends it as a normal forwarded message.',
    descriptionKey: 'tools.commands.rvo.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid } = ctx;

    const getMessage = (m: any): { msg: any; isViewOnce: boolean } => {
        if (!m) return { msg: null, isViewOnce: false };
        if (m.viewOnceMessage?.message) {
            const res = getMessage(m.viewOnceMessage.message);
            return { msg: res.msg, isViewOnce: true };
        }
        if (m.viewOnceMessageV2?.message) {
            const res = getMessage(m.viewOnceMessageV2.message);
            return { msg: res.msg, isViewOnce: true };
        }
        if (m.viewOnceMessageV2Extension?.message) {
            const res = getMessage(m.viewOnceMessageV2Extension.message);
            return { msg: res.msg, isViewOnce: true };
        }
        return { msg: m, isViewOnce: false };
    };

    const quotedMsgInfo = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsgRaw = quotedMsgInfo?.quotedMessage;

    if (!quotedMsgRaw) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    const { msg: quotedMsg, isViewOnce: wrapperIsViewOnce } = getMessage(quotedMsgRaw);

    const imageMessage = quotedMsg?.imageMessage;
    const videoMessage = quotedMsg?.videoMessage;
    const audioMessage = quotedMsg?.audioMessage;

    const isViewOnce = wrapperIsViewOnce || imageMessage?.viewOnce || videoMessage?.viewOnce || audioMessage?.viewOnce;

    if (!isViewOnce) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    if (!imageMessage && !videoMessage && !audioMessage) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    try {
        let type: 'image' | 'video' | 'audio';
        let mediaMessage: any;

        if (imageMessage) {
            type = 'image';
            mediaMessage = imageMessage;
        } else if (videoMessage) {
            type = 'video';
            mediaMessage = videoMessage;
        } else {
            type = 'audio';
            mediaMessage = audioMessage;
        }

        const stream = await downloadContentFromMessage(mediaMessage, type);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        const senderRaw = msg.key.fromMe
            ? sock.user?.id || msg.key.participant || msg.key.remoteJid
            : msg.key.participant || msg.key.remoteJid;
        const normalizedSender = senderRaw ? jidNormalizedUser(senderRaw) : '';

        const contextInfo = {
            isForwarded: true,
            forwardingScore: 999,
            participant: '0@s.whatsapp.net',
            stanzaId: 'WHATSAPP_RVO',
            quotedMessage: { conversation: 'Done.' },
            mentionedJid: normalizedSender ? [normalizedSender] : []
        };

        let sentMsg: any;
        if (type === 'image') {
            sentMsg = await sock.sendMessage(jid, {
                image: buffer,
                caption: mediaMessage.caption || '',
                contextInfo
            });
        } else if (type === 'video') {
            sentMsg = await sock.sendMessage(jid, {
                video: buffer,
                caption: mediaMessage.caption || '',
                mimetype: mediaMessage.mimetype,
                contextInfo
            });
        } else if (type === 'audio') {
            sentMsg = await sock.sendMessage(jid, {
                audio: buffer,
                ptt: mediaMessage.ptt || false,
                mimetype: mediaMessage.mimetype,
                contextInfo
            });
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });

        // Auto-delete the revealed message after 10 seconds
        if (sentMsg?.key) {
            setTimeout(async () => {
                await sock.sendMessage(jid, { delete: sentMsg.key }).catch(() => {});
            }, 10000);
        }

        console.log('Revealed view-once message', { jid, type });
        return;
    } catch (err: any) {
        console.error('[Read View Once Error]', err);
        console.error('Failed to reveal view-once message', { error: err.message });
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }
}
