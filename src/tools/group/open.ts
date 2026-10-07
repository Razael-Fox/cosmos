import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { ModerationService } from '../../services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group open',
    title: 'Open Group',
    displayNames: { en: 'Group Open', id: 'Buka Grup' },
    category: 'Moderation',
    aliases: ['gopen', '.gopen', '.group open', 'group open', '.g open', 'g open'],
    description: 'Allow all members to send messages in the group.',
    descriptionKey: 'tools.commands.group_open.description'
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

    const result = await modService.setGroupAnnounce(jid, false, callerJid);

    if (result.success) {
        return t('tools.group_open.success');
    }
    if (result.message === 'RATE_LIMIT_EXCEEDED') {
        return t('core.rate_limited');
    }
    if (result.message === 'ALREADY_OPEN') {
        return t('tools.group_open.already_open');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_open.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
