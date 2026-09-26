import { ToolDefinition, ToolContext } from './types.js';
import { isAutoArchiveEnabled, setAutoArchive } from '../services/systemConfigService.js';
import { archiveChat, unarchiveChat } from '../services/chatArchiveService.js';
import { getSenderJid } from '../utils/casino.js';
import { isOwnerId } from '../utils/owner.js';
import { renderCard } from '../utils/uiFormatter.js';

export const definition: ToolDefinition = {
    name: 'autoarchive',
    title: 'Auto-Archive Settings',
    displayNames: {
        en: 'auto archive',
        id: 'arsip otomatis'
    },
    category: 'System',
    aliases: [
        '.auto archive',
        'auto archive',
        '.arsip otomatis',
        'arsip otomatis',
        '.auto-archive',
        'auto-archive',
        '.auto_archive',
        'auto_archive',
        '.autoarchive',
        'autoarchive',
        '.archive',
        'archive',
        '.unarchive',
        'unarchive'
    ],
    description:
        'Configure automatic group archiving upon bot joining, view current archive status, or manually archive/unarchive chats.',
    descriptionKey: 'tools.commands.autoarchive.description',
    parameters: {
        type: 'object',
        properties: {
            subcommand: {
                type: 'string',
                description: 'Action: on, off, status, archive [jid], unarchive [jid]'
            },
            target: {
                type: 'string',
                description: 'Optional chat or group JID to manually archive/unarchive'
            }
        }
    }
};

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid, t } = ctx;
    const callerJid = getSenderJid(msg, sock);
    const isOwner = Boolean(callerJid && isOwnerId(callerJid)) || Boolean(msg.key?.fromMe);

    // Extract raw command and parameters
    const unwrapped =
        msg.message?.viewOnceMessage?.message ||
        msg.message?.viewOnceMessageV2?.message ||
        msg.message?.viewOnceMessageV2Extension?.message ||
        msg.message;
    const rawText =
        unwrapped?.conversation ||
        unwrapped?.extendedTextMessage?.text ||
        unwrapped?.imageMessage?.caption ||
        unwrapped?.videoMessage?.caption ||
        '';

    const tokens = rawText.trim().split(/\s+/).filter(Boolean);
    const firstToken = tokens[0]?.toLowerCase().replace(/^\./, '') || '';
    const secondToken = tokens[1]?.toLowerCase() || '';

    let subcommand: string;
    let targetArg: string;

    if (
        (firstToken === 'auto' && secondToken === 'archive') ||
        (firstToken === 'arsip' && secondToken === 'otomatis')
    ) {
        // Multi-word invocation: ".auto archive [on|off|status]" or ".arsip otomatis [on|off]"
        const subArgs = tokens.slice(2);
        subcommand =
            subArgs[0]?.toLowerCase() || (typeof args.subcommand === 'string' ? args.subcommand.toLowerCase() : '');
        targetArg = subArgs[1] || (typeof args.target === 'string' ? args.target : '');
    } else if (firstToken === 'archive') {
        // ".archive [jid]"
        subcommand = 'archive';
        const subArgs = tokens.slice(1);
        targetArg = subArgs[0] || (typeof args.target === 'string' ? args.target : '');
    } else if (firstToken === 'unarchive') {
        // ".unarchive [jid]"
        subcommand = 'unarchive';
        const subArgs = tokens.slice(1);
        targetArg = subArgs[0] || (typeof args.target === 'string' ? args.target : '');
    } else {
        // Single-token invocation: ".autoarchive [on|off|status]" or LLM tool-calling with args
        const subArgs = tokens.slice(1);
        subcommand =
            subArgs[0]?.toLowerCase() || (typeof args.subcommand === 'string' ? args.subcommand.toLowerCase() : '');
        targetArg = subArgs[1] || (typeof args.target === 'string' ? args.target : '');
    }

    subcommand = subcommand.trim();

    // =========================================================================
    // 1. MANUAL ARCHIVE: .archive [jid] or .auto archive archive [jid]
    // =========================================================================
    if (subcommand === 'archive') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        const targetJid = targetArg || (jid.endsWith('@g.us') ? jid : '');

        if (!targetJid) {
            const errorCard = renderCard({
                title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
                icon: '⚠️',
                body: t(
                    'tools.autoarchive.missing_target',
                    'Please specify a valid group JID or invoke this command inside a group chat.'
                ),
                footer: '💡 Usage: .auto archive <groupJid>',
                t
            });
            await sock.sendMessage(jid, { text: errorCard }, { quoted: msg });
            return;
        }

        const success = await archiveChat(sock, targetJid);
        if (success) {
            const card = renderCard({
                title: t('tools.autoarchive.manual_archive_title', 'Chat Archived'),
                icon: '📦',
                body: t('tools.autoarchive.manual_archive_success', 'The chat has been successfully archived.'),
                fields: [{ label: 'Chat JID', value: targetJid }],
                t
            });
            await sock.sendMessage(jid, { text: card }, { quoted: msg });
        } else {
            const card = renderCard({
                title: t('tools.autoarchive.manual_archive_title', 'Chat Archive Failed'),
                icon: '❌',
                body: t(
                    'tools.autoarchive.manual_archive_error',
                    'Failed to archive chat. Please ensure the bot is participating in the chat.'
                ),
                fields: [{ label: 'Chat JID', value: targetJid }],
                t
            });
            await sock.sendMessage(jid, { text: card }, { quoted: msg });
        }
        return;
    }

    // =========================================================================
    // 2. MANUAL UNARCHIVE: .unarchive [jid] or .auto archive unarchive [jid]
    // =========================================================================
    if (subcommand === 'unarchive') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        const targetJid = targetArg || (jid.endsWith('@g.us') ? jid : '');

        if (!targetJid) {
            const errorCard = renderCard({
                title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
                icon: '⚠️',
                body: t(
                    'tools.autoarchive.missing_target',
                    'Please specify a valid group JID or invoke this command inside a group chat.'
                ),
                footer: '💡 Usage: .auto archive <groupJid>',
                t
            });
            await sock.sendMessage(jid, { text: errorCard }, { quoted: msg });
            return;
        }

        const success = await unarchiveChat(sock, targetJid);
        if (success) {
            const card = renderCard({
                title: t('tools.autoarchive.manual_unarchive_title', 'Chat Unarchived'),
                icon: '📂',
                body: t('tools.autoarchive.manual_unarchive_success', 'The chat has been successfully unarchived.'),
                fields: [{ label: 'Chat JID', value: targetJid }],
                t
            });
            await sock.sendMessage(jid, { text: card }, { quoted: msg });
        } else {
            const card = renderCard({
                title: t('tools.autoarchive.manual_unarchive_title', 'Chat Unarchive Failed'),
                icon: '❌',
                body: t(
                    'tools.autoarchive.manual_unarchive_error',
                    'Failed to unarchive chat. Please verify that the target chat exists.'
                ),
                fields: [{ label: 'Chat JID', value: targetJid }],
                t
            });
            await sock.sendMessage(jid, { text: card }, { quoted: msg });
        }
        return;
    }

    // =========================================================================
    // 3. TOGGLE AUTO-ARCHIVE: .auto archive on|off
    // =========================================================================
    const action = subcommand;

    if (action === 'on' || action === 'enable' || action === '1' || action === 'true') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        setAutoArchive(true);
        const card = renderCard({
            title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
            icon: '⚡',
            body: t(
                'tools.autoarchive.enabled_body',
                'Auto-archiving on group join has been *ENABLED*.\n\nEvery group the bot joins will automatically be moved to the archive.'
            ),
            fields: [
                { label: 'Status', value: 'ENABLED' },
                { label: 'Updated By', value: callerJid || 'Bot Owner' }
            ],
            footer: '💡 Tip: To manually archive a specific chat, use .auto archive <groupJid>',
            t
        });
        await sock.sendMessage(jid, { text: card }, { quoted: msg });
        return;
    }

    if (action === 'off' || action === 'disable' || action === '0' || action === 'false') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        setAutoArchive(false);
        const card = renderCard({
            title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
            icon: '⏸️',
            body: t(
                'tools.autoarchive.disabled_body',
                'Auto-archiving on group join has been *DISABLED*.\n\nNewly joined groups will remain in your primary chat list.'
            ),
            fields: [
                { label: 'Status', value: 'DISABLED' },
                { label: 'Updated By', value: callerJid || 'Bot Owner' }
            ],
            footer: '💡 Tip: To re-enable, run .auto archive on',
            t
        });
        await sock.sendMessage(jid, { text: card }, { quoted: msg });
        return;
    }

    // =========================================================================
    // 4. STATUS DASHBOARD: .auto archive / .auto archive status
    // =========================================================================
    const currentStatus = isAutoArchiveEnabled() ? 'ENABLED' : 'DISABLED';
    const statusCard = renderCard({
        title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
        icon: '📦',
        subtitle: 'Cosmos Group Auto-Archive Engine',
        body: t(
            'tools.autoarchive.dashboard_body',
            'Automatically archive new groups upon joining to maintain a clean chat inbox.'
        ),
        fields: [
            { label: 'Auto-Archive on Join', value: currentStatus },
            { label: 'Command Syntax', value: '.auto archive <on|off>' }
        ],
        sections: [
            {
                title: 'Available Actions',
                items: [
                    { icon: '⚡', label: '.auto archive on', value: 'Enable auto-archiving on join' },
                    { icon: '⏸️', label: '.auto archive off', value: 'Disable auto-archiving on join' },
                    { icon: '📦', label: '.archive', value: 'Archive current group chat' },
                    { icon: '📂', label: '.unarchive', value: 'Unarchive current group chat' }
                ]
            }
        ],
        footer: '💡 Cosmos Enterprise Archive Management',
        t
    });

    await sock.sendMessage(jid, { text: statusCard }, { quoted: msg });
}
