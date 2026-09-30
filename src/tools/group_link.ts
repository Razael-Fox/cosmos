import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group link',
    title: 'Get Group Link',
    displayNames: { en: 'Group Link', id: 'Tautan Grup' },
    category: 'Moderation',
    aliases: ['glink', '.glink', '.group link', 'group link', '.g link', 'g link'],
    description: 'Retrieve the current group invite link.',
    descriptionKey: 'tools.commands.group_link.description'
};

export async function execute(_args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
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

    const result = await modService.getGroupLink(jid, callerJid);

    if (result.success && result.data?.link) {
        return t('tools.group_link.success', { link: result.data.link });
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_link.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
