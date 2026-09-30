import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';

export const definition: ToolDefinition = {
    name: 'group rename',
    title: 'Rename Group',
    displayNames: { en: 'Group Rename', id: 'Ubah Nama Grup' },
    category: 'Moderation',
    aliases: ['grename', '.grename', '.group rename', 'group rename', '.g rename', 'g rename'],
    description: 'Change the group title/name.',
    descriptionKey: 'tools.commands.group_rename.description',
    parameters: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'New group title (1-25 characters)'
            }
        },
        required: ['name']
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

    const newName = typeof args.name === 'string' ? args.name.trim() : '';
    if (newName.length < 1) {
        return t('tools.group_rename.too_short');
    }
    if (newName.length > 25) {
        return t('tools.group_rename.too_long');
    }

    const result = await modService.updateGroupSubject(jid, newName, callerJid);

    if (result.success) {
        return t('tools.group_rename.success', { name: newName });
    }
    if (result.message === 'TOO_SHORT') {
        return t('tools.group_rename.too_short');
    }
    if (result.message === 'TOO_LONG') {
        return t('tools.group_rename.too_long');
    }
    if (result.message === 'BOT_NOT_ADMIN') {
        return t('tools.group_kick.bot_not_admin');
    }

    return t('tools.group_rename.error', { error: result.message });
}

export default { definition, execute } as ToolModule;
