import { ToolDefinition, ToolContext } from './types.js';

export const definition: ToolDefinition = {
    name: 'quoted',
    title: 'Forward Quoted Message',
    category: 'Tools & Utilities',
    aliases: ['q'],
    description:
        'Forwards the message quoted by another user. Reply to a message that quotes another message with .q to forward the original message.',
    descriptionKey: 'tools.commands.quoted.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const getMessageAndContext = (m: any): { msg: any; contextInfo: any } => {
    if (!m) return { msg: null, contextInfo: null };
    if (m.viewOnceMessage?.message) return getMessageAndContext(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return getMessageAndContext(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension?.message) return getMessageAndContext(m.viewOnceMessageV2Extension.message);

    let contextInfo = null;
    if (m.extendedTextMessage?.contextInfo) contextInfo = m.extendedTextMessage.contextInfo;
    else if (m.imageMessage?.contextInfo) contextInfo = m.imageMessage.contextInfo;
    else if (m.videoMessage?.contextInfo) contextInfo = m.videoMessage.contextInfo;
    else if (m.documentMessage?.contextInfo) contextInfo = m.documentMessage.contextInfo;
    else if (m.audioMessage?.contextInfo) contextInfo = m.audioMessage.contextInfo;

    return { msg: m, contextInfo };
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid } = ctx;

    const messageAId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const messageAParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const quotedMsgRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!messageAId || !quotedMsgRaw) {
        return ctx.t('tools.quoted.reply_required');
    }

    const { getCachedMessage } = await import('#utils/messageCache.js');

    // Attempt to get the unstripped Message A from the cache
    const fullMessageA = getCachedMessage(messageAId) || quotedMsgRaw;

    const { contextInfo: messageAContextInfo } = getMessageAndContext(fullMessageA);

    let targetMsg: any;
    let targetStanzaId: string | undefined;
    let targetParticipant: string | undefined;

    if (messageAContextInfo && messageAContextInfo.stanzaId) {
        // Message A is a reply to OM (Original Message). We want to forward OM.
        targetStanzaId = messageAContextInfo.stanzaId;
        targetParticipant = messageAContextInfo.participant;

        if (messageAContextInfo.quotedMessage) {
            targetMsg = messageAContextInfo.quotedMessage;
        } else {
            targetMsg = targetStanzaId ? getCachedMessage(targetStanzaId) : undefined;
        }

        if (!targetMsg) {
            return ctx.t('tools.quoted.too_old');
        }
    } else {
        // Message A is not a reply. Fallback to forwarding Message A itself.
        targetMsg = fullMessageA;
        targetStanzaId = messageAId;
        targetParticipant = messageAParticipant || undefined;
    }

    if (!targetMsg) {
        return ctx.t('tools.quoted.not_found');
    }

    const unwrapMessage = (m: any): any => {
        if (!m) return m;
        if (m.viewOnceMessage?.message) return unwrapMessage(m.viewOnceMessage.message);
        if (m.viewOnceMessageV2?.message) return unwrapMessage(m.viewOnceMessageV2.message);
        if (m.viewOnceMessageV2Extension?.message) return unwrapMessage(m.viewOnceMessageV2Extension.message);
        return m;
    };

    targetMsg = unwrapMessage(targetMsg);

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    try {
        const fakeWaMessage: any = {
            key: {
                remoteJid: jid,
                fromMe: false,
                id: targetStanzaId || '',
                participant: targetParticipant || ''
            },
            message: targetMsg
        };

        await sock.sendMessage(jid, { forward: fakeWaMessage });

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        console.log('Forwarded quoted message', { jid });
    } catch (err: any) {
        console.error('[Quoted Error]', err);
        console.error('Failed to forward quoted message', { error: err.message });
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('tools.quoted.forward_failed');
    }
}
