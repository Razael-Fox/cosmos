import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group close',
    title: 'Close Group',
    displayNames: { en: 'Group Close', id: 'Tutup Grup' },
    category: 'Moderation',
    aliases: ['gclose', '.gclose', '.group close', 'group close', '.g close', 'g close'],
    description: 'Set the group to admin-only messaging mode.',
    descriptionKey: 'tools.commands.group_close.description'
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

    const result = await modService.setGroupAnnounce(jid, true, callerJid);

    if (result.success) {
        return t('tools.group_close.success');
    }
    if (result.message === 'ALREADY_CLOSED') {
        return t('tools.group_close.already_closed');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_close.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
