import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';
import { cleanId } from '../utils/casino.js';

export const definition: ToolDefinition = {
    name: 'group blacklist add',
    title: 'Add to Group Blacklist',
    displayNames: { en: 'Group Blacklist Add', id: 'Tambah Daftar Hitam Grup' },
    category: 'Moderation',
    aliases: [
        'gbl add',
        '.gbl add',
        '.group blacklist add',
        'group blacklist add',
        '.g blacklist add',
        'g blacklist add'
    ],
    description: 'Add a user to the group blacklist.',
    descriptionKey: 'tools.commands.group_blacklist_add.description',
    parameters: {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: 'Phone number, @mention, or reply to message'
            },
            reason: {
                type: 'string',
                description: 'Optional reason for blacklisting'
            }
        },
        required: ['target']
    }
};

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

    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;

    let targetJid: string | null = null;
    let reason = '';

    const rawTarget = typeof args.target === 'string' ? args.target.trim() : '';
    const rawReason = typeof args.reason === 'string' ? args.reason.trim() : '';

    if (mentions && mentions.length > 0 && mentions[0]) {
        targetJid = mentions[0];
        // Strip mention from text to get reason
        const cleanedMentionId = cleanId(targetJid);
        const withoutMention = rawTarget.replace(new RegExp(`@?${cleanedMentionId}`, 'g'), '').trim();
        reason = rawReason || withoutMention;
    } else if (quotedParticipant) {
        targetJid = quotedParticipant;
        reason = rawReason || rawTarget;
    } else if (rawTarget) {
        const tokens = rawTarget.split(/\s+/);
        const firstToken = tokens[0].replace(/^@/, '').replace(/\D/g, '');
        if (firstToken.length >= 8 && firstToken.length <= 15) {
            targetJid = `${firstToken}@s.whatsapp.net`;
            reason = rawReason || tokens.slice(1).join(' ').trim();
        }
    }

    if (!targetJid) {
        return t('tools.group_kick.no_target');
    }

    if (!reason) {
        reason = t('tools.group_blacklist_add.no_reason');
    }

    const result = await modService.addToBlacklist(jid, targetJid, reason, callerJid);
    const targetDisplay = `@${cleanId(targetJid)}`;

    if (result.success) {
        let response = t('tools.group_blacklist_add.success', { target: targetDisplay, reason });
        if (result.data?.kicked) {
            response += `\n\n${t('tools.group_blacklist_add.kicked', { target: targetDisplay })}`;
        }
        return response;
    }

    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'ALREADY_BLACKLISTED') {
        return t('tools.group_blacklist_add.already_blacklisted', { target: targetDisplay });
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_blacklist_add.error', { target: targetDisplay, error: result.message });
}

export default { definition, execute } as ToolModule;
