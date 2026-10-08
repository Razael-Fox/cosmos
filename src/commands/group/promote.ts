import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { ModerationService, resolveTargetJid } from '#services/moderationService.js';
import { cleanId } from '#utils/casino.js';

export const definition: ToolDefinition = {
    name: 'group promote',
    title: 'Promote to Admin',
    displayNames: { en: 'Group Promote', id: 'Promosikan Admin' },
    category: 'Moderation',
    aliases: ['gpromote', '.gpromote', '.group promote', 'group promote', '.g promote', 'g promote'],
    description: 'Grant admin privileges to a group member.',
    descriptionKey: 'tools.commands.group_promote.description',
    parameters: {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: 'Phone number, @mention, or reply to message'
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

    const result = await modService.promoteAdmin(jid, targetJid, callerJid);
    const targetDisplay = `@${cleanId(targetJid)}`;

    if (result.success) {
        return t('tools.group_promote.success', { target: targetDisplay });
    }
    if (result.message === 'ALREADY_ADMIN') {
        return t('tools.group_promote.already_admin', { target: targetDisplay });
    }
    if (result.message === 'TARGET_NOT_MEMBER') {
        return t('tools.group_promote.target_not_member', { target: targetDisplay });
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_promote.error', { target: targetDisplay, error: result.message });
}

export default { definition, execute } as ToolModule;
