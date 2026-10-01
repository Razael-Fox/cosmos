import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

export const definition: ToolDefinition = {
    name: 'group description',
    title: 'Edit Group Description',
    displayNames: { en: 'Group Description', id: 'Deskripsi Grup' },
    category: 'Moderation',
    aliases: ['gdesc', '.gdesc', '.group description', 'group description', '.g description', 'g description'],
    description: 'Change the group description.',
    descriptionKey: 'tools.commands.group_description.description',
    parameters: {
        type: 'object',
        properties: {
            description: {
                type: 'string',
                description: 'Inline text, quoted reply text, or attached .txt/.md document'
            }
        }
    }
};

const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100 KB

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const { sock, msg, jid, t } = ctx;

    if (!jid.endsWith('@g.us')) {
        return t('core.group_only');
    }

    const modService = new ModerationService(sock);
    const callerJid = msg.key.participant || msg.key.remoteJid || '';

    const isCallerAdm = await modService.isUserAdmin(jid, callerJid);
    if (!isCallerAdm) {
        return t('tools.group_kick.caller_not_admin');
    }

    const isBotAdm = await modService.isBotAdmin(jid);
    if (!isBotAdm) {
        return t('tools.group_kick.bot_not_admin');
    }

    let candidateDescription = '';

    // 1. Inline text from args
    if (typeof args.description === 'string' && args.description.trim().length > 0) {
        candidateDescription = args.description.trim();
    }

    // 2. Quoted text message if candidate is still empty
    if (!candidateDescription && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
        if (quoted.conversation && quoted.conversation.trim().length > 0) {
            candidateDescription = quoted.conversation.trim();
        } else if (quoted.extendedTextMessage?.text && quoted.extendedTextMessage.text.trim().length > 0) {
            candidateDescription = quoted.extendedTextMessage.text.trim();
        }
    }

    // 3. Document attachment (.txt or .md) either directly on msg or quoted
    const docMsg =
        msg.message?.documentMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;

    if (!candidateDescription && docMsg) {
        const fileName = (docMsg.fileName || '').toLowerCase();
        const isSupportedExt = fileName.endsWith('.txt') || fileName.endsWith('.md');
        if (!isSupportedExt) {
            return t('tools.group_description.unsupported_file');
        }

        const rawLength = docMsg.fileLength;
        const fileSize =
            typeof rawLength === 'number'
                ? rawLength
                : typeof rawLength === 'object' &&
                    rawLength !== null &&
                    'low' in rawLength &&
                    typeof (rawLength as { low: unknown }).low === 'number'
                  ? (rawLength as { low: number }).low
                  : 0;

        if (fileSize > MAX_FILE_SIZE_BYTES) {
            return t('tools.group_description.file_too_large');
        }

        try {
            const stream = await downloadContentFromMessage(docMsg, 'document');
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk as Buffer);
            }
            const buffer = Buffer.concat(chunks);
            if (buffer.length > MAX_FILE_SIZE_BYTES) {
                return t('tools.group_description.file_too_large');
            }
            candidateDescription = buffer.toString('utf-8').trim();
        } catch (err) {
            console.error('[group description] Error downloading document:', err);
            return t('tools.group_description.error', { error: 'Failed to read document' });
        }
    }

    if (!candidateDescription) {
        return t('tools.group_description.usage');
    }

    if (candidateDescription.length < 1) {
        return t('tools.group_description.empty');
    }

    if (candidateDescription.length > 512) {
        return t('tools.group_description.too_long');
    }

    const result = await modService.updateGroupDescription(jid, candidateDescription, callerJid);

    if (result.success) {
        return t('tools.group_description.success');
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'EMPTY') {
        return t('tools.group_description.empty');
    }
    if (result.message === 'TOO_LONG') {
        return t('tools.group_description.too_long');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_description.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
