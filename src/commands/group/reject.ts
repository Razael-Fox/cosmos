import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { ModerationService, resolveTargetJid } from '#services/moderationService.js';
import { cleanId } from '#lib/casino.js';

export const definition: ToolDefinition = {
    name: 'group reject',
    title: 'Reject Join Request',
    displayNames: { en: 'Group Reject', id: 'Tolak Permintaan Gabung' },
    category: 'Moderation',
    aliases: ['greject', '.greject', '.group reject', 'group reject', '.g reject', 'g reject'],
    description: 'Reject a pending join request.',
    descriptionKey: 'tools.commands.group_reject.description',
    parameters: {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: 'Phone number, @mention, or reply'
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

    const targetInput = typeof args.target === 'string' ? args.target : undefined;
    const targetJid = resolveTargetJid(msg, targetInput);
    if (!targetJid) {
        return t('tools.group_kick.no_target');
    }

    const result = await modService.rejectJoinRequest(jid, targetJid, callerJid);
    const targetDisplay = `@${cleanId(targetJid)}`;

    if (result.success) {
        return t('tools.group_reject.success', { target: targetDisplay });
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_reject.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
