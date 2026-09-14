import { downloadContentFromMessage, WAMessage } from '@whiskeysockets/baileys';
import { toFile } from 'groq-sdk';
import dotenv from 'dotenv';
import { ToolDefinition, ToolContext } from './types.js';
import { getGroqClient } from '#utils/apiKeyResolver.js';

dotenv.config();

export const definition: ToolDefinition = {
    name: 'stt',
    title: 'Speech to Text (Transcribe)',
    category: 'AI & Correction',
    aliases: ['.stt', '.ptt'],
    description: 'Transcribes a quoted voice note into text using Groq Whisper.',
    descriptionKey: 'tools.commands.stt.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | null> {
    const contextInfo = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const quotedMessage = contextInfo?.quotedMessage;
    const audioMessage = quotedMessage?.audioMessage;

    if (!contextInfo || !audioMessage) {
        return ctx.t('tools.stt.quote_required');
    }

    if (!audioMessage.ptt) {
        return ctx.t('tools.stt.not_ptt');
    }

    try {
        // Download audio stream from quoted message
        const stream = await downloadContentFromMessage(audioMessage, 'audio');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Send to Groq Whisper using SDK toFile helper
        const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' });
        const transcription: any = await getGroqClient().audio.transcriptions.create({
            file,
            model: 'whisper-large-v3-turbo',
            response_format: 'text'
        });

        const rawText = typeof transcription === 'string' ? transcription : transcription?.text;
        const text = typeof rawText === 'string' ? rawText.trim() : '';

        if (!text) {
            return ctx.t('tools.stt.no_text');
        }

        console.log('STT transcription success', { jid: ctx.jid, length: text.length });

        // Accurately detect if quoted voice note is from bot number (supports JID & LID)
        const cleanId = (idStr?: string | null) => (idStr ? idStr.split(':')[0].split('@')[0] : null);
        const botRawJid = cleanId(ctx.sock.user?.id);
        const botRawLid = cleanId(ctx.sock.user?.lid);
        const participantRaw = cleanId(contextInfo.participant);

        const isQuotedFromMe =
            !contextInfo.participant ||
            (botRawJid !== null && participantRaw === botRawJid) ||
            (botRawLid !== null && participantRaw === botRawLid);

        // Reconstruct quoted message object pointing to original voice note
        const quotedVoiceNote: WAMessage = {
            key: {
                remoteJid: ctx.jid,
                id: contextInfo.stanzaId || undefined,
                fromMe: isQuotedFromMe,
                ...(contextInfo.participant && { participant: contextInfo.participant })
            },
            message: quotedMessage
        };

        await ctx.sock.sendMessage(ctx.jid, { text }, { quoted: quotedVoiceNote });

        // Return null so message.js does not send duplicate messages
        return null;
    } catch (err: any) {
        console.error('[STT Tool Error]', err);
        console.error('STT transcription failed', { jid: ctx.jid, error: err.message });
        return ctx.t('tools.stt.error');
    }
}
