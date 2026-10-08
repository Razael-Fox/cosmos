import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { ModerationService } from '#services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group approve',
    title: 'Approve Join Request',
    displayNames: { en: 'Group Approve', id: 'Setujui Permintaan Gabung' },
    category: 'Moderation',
    aliases: ['gapprove', '.gapprove', '.group approve', 'group approve', '.g approve', 'g approve'],
    description: 'Approve a pending join request.',
    descriptionKey: 'tools.commands.group_approve.description',
    parameters: {
        type: 'object',
        properties: {
            phone: {
                type: 'string',
                description: 'Phone number (digits only) or "all"'
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

    const rawInput = typeof args.phone === 'string' ? args.phone.trim() : '';
    if (!rawInput) {
        return t('tools.group_approve.usage');
    }

    if (rawInput.toLowerCase() === 'all') {
        const { count, error } = await modService.approveAllJoinRequests(jid, callerJid);
        if (error === 'BOT_NOT_ADMIN') {
            return t('tools.group_kick.bot_not_admin');
        }
        if (count === 0) {
            return t('tools.group_approve.empty');
        }
        return t('tools.group_approve.success_all', { count });
    }

    const digits = rawInput.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
        return t('tools.group_approve.invalid_phone');
    }

    const targetJid = `${digits}@s.whatsapp.net`;
    const result = await modService.approveJoinRequest(jid, targetJid, callerJid);

    if (result.success) {
        return t('tools.group_approve.success', { phone: digits });
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_approve.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
