import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { ModerationService } from '../../services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group invite',
    title: 'Invite Member',
    displayNames: { en: 'Group Invite', id: 'Undang Anggota' },
    category: 'Moderation',
    aliases: ['ginvite', '.ginvite', '.group invite', 'group invite', '.g invite', 'g invite'],
    description: 'Send a group invite link via direct message as a native Markdown message.',
    descriptionKey: 'tools.commands.group_invite.description',
    parameters: {
        type: 'object',
        properties: {
            phone: {
                type: 'string',
                description: 'Phone number in international format'
            }
        },
        required: ['phone']
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

    const phoneRaw = typeof args.phone === 'string' ? args.phone.trim() : '';
    if (!phoneRaw) {
        return t('tools.group_invite.invalid_phone');
    }

    const senderName = msg.pushName || 'Admin';
    const result = await modService.inviteMember(jid, phoneRaw, senderName, callerJid, t);
    const targetPhone = (result.data?.phone as string | undefined) || phoneRaw;

    if (result.success) {
        return t('tools.group_invite.success', { phone: targetPhone });
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'ALREADY_MEMBER') {
        return t('tools.group_invite.already_member', { phone: targetPhone });
    }
    if (result.message === 'INVALID_PHONE') {
        return t('tools.group_invite.invalid_phone');
    }
    if (result.message === 'DM_FAILED') {
        return t('tools.group_invite.dm_failed', { phone: targetPhone });
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_invite.error', { phone: targetPhone, error: result.message });
}

export default { definition, execute } as ToolModule;
