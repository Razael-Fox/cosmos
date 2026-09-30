import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { ModerationService } from '../services/moderationService.js';
import { cleanId } from '../utils/casino.js';

export const definition: ToolDefinition = {
    name: 'group blacklist list',
    title: 'List Group Blacklist',
    displayNames: { en: 'Group Blacklist List', id: 'Daftar Hitam Grup' },
    category: 'Moderation',
    aliases: [
        'gbl list',
        '.gbl list',
        '.group blacklist list',
        'group blacklist list',
        '.g blacklist list',
        'g blacklist list'
    ],
    description: 'List all blacklisted users for this group.',
    descriptionKey: 'tools.commands.group_blacklist_list.description'
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

    const result = await modService.getBlacklist(jid);
    if (!result.success) {
        return t('tools.group_blacklist_list.error', { error: result.message });
    }

    const entries = Array.isArray(result.data?.entries)
        ? (result.data.entries as Array<{ userJid: string; reason: string; addedAt: Date }>)
        : [];

    if (entries.length === 0) {
        return t('tools.group_blacklist_list.empty');
    }

    const header = t('tools.group_blacklist_list.title', { count: entries.length });
    const formattedEntries = entries.map((entry) => {
        const targetDisplay = `@${cleanId(entry.userJid)}`;
        const dateStr =
            entry.addedAt instanceof Date
                ? entry.addedAt.toISOString().split('T')[0]
                : String(entry.addedAt || '').split('T')[0];
        return t('tools.group_blacklist_list.entry', {
            target: targetDisplay,
            reason: entry.reason,
            date: dateStr
        });
    });

    return `${header}\n\n${formattedEntries.join('\n\n')}`;
}

export default { definition, execute } as ToolModule;
