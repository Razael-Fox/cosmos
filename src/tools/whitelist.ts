import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { prisma, addGroup, removeGroup, isGroupWhitelisted, getAllWhitelistedGroups } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { isOwnerId } from '../utils/owner.js';
import { renderCard, renderCatalogCard, renderBadge, CatalogItem } from '../utils/uiFormatter.js';
import {
    isAutoWhitelistEnabled,
    setAutoWhitelist,
    isAutoArchiveEnabled,
    setAutoArchive
} from '../services/systemConfigService.js';
import { getCachedParticipatingGroups } from '../services/agentEngine/prompts/contextResolver.js';

export const definition: ToolDefinition = {
    name: 'whitelist',
    title: 'Group Whitelist Suite',
    category: 'System',
    aliases: ['listgroup', 'grouplist', 'groups', 'whitelistall', 'addallgroups'],
    description:
        'Manage Cosmos group whitelisting, view all participating groups with status, batch-whitelist groups, or configure auto-whitelisting.',
    descriptionKey: 'tools.commands.whitelist.description',
    parameters: {
        type: 'object',
        properties: {
            subcommand: {
                type: 'string',
                description: 'Action: list, all, status, auto <on|off>, add [jid], remove [jid]'
            },
            target: {
                type: 'string',
                description: 'Optional group JID or filter keyword (whitelisted / unwhitelisted)'
            }
        }
    }
};

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid, t } = ctx;
    const callerJid = getSenderJid(msg, sock);
    const isOwner = Boolean(callerJid && isOwnerId(callerJid)) || Boolean(msg.key?.fromMe);

    // Determine invoked command and argument string
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

    const tokens = rawText.trim().split(/\s+/);
    const invokedCommand = tokens[0]?.toLowerCase().replace(/^\./, '') || 'whitelist';
    const subArgs = tokens.slice(1);

    let subcommand = (
        subArgs[0]?.toLowerCase() || (typeof args.subcommand === 'string' ? args.subcommand.toLowerCase() : '')
    ).trim();

    // Map command aliases to appropriate subcommands
    if (invokedCommand === 'listgroup' || invokedCommand === 'grouplist' || invokedCommand === 'groups') {
        subcommand = 'list';
    } else if (invokedCommand === 'whitelistall' || invokedCommand === 'addallgroups') {
        subcommand = 'all';
    }

    // =========================================================================
    // 1. SUBCOMMAND: LIST (.listgroup / .groups / .whitelist list)
    // =========================================================================
    if (subcommand === 'list') {
        let participatingGroups: Record<string, any> = {};
        try {
            participatingGroups = await getCachedParticipatingGroups(sock);
        } catch (err) {
            console.warn('[WhitelistTool] Failed to fetch participating groups:', err);
        }

        const groupEntries = Object.entries(participatingGroups).filter(
            ([id, meta]) => id && id.endsWith('@g.us') && meta
        );

        if (groupEntries.length === 0) {
            const noGroupsMsg = renderCard({
                title: t('tools.whitelist.list_title', 'Available WhatsApp Groups'),
                icon: '📋',
                body: t('tools.whitelist.no_groups', 'The bot is not currently participating in any WhatsApp groups.'),
                t
            });
            await sock.sendMessage(jid, { text: noGroupsMsg }, { quoted: msg });
            return;
        }

        const allWhitelisted = await getAllWhitelistedGroups();
        const whitelistedSet = new Set(allWhitelisted);

        // Optional filter: whitelisted or unwhitelisted
        const filterKeyword = (subArgs[1] || (typeof args.target === 'string' ? args.target : '')).toLowerCase();
        let filteredEntries = groupEntries;
        if (filterKeyword === 'whitelisted' || filterKeyword === 'wl') {
            filteredEntries = groupEntries.filter(([id]) => whitelistedSet.has(id));
        } else if (filterKeyword === 'unwhitelisted' || filterKeyword === 'unwl') {
            filteredEntries = groupEntries.filter(([id]) => !whitelistedSet.has(id));
        }

        const catalogItems: CatalogItem[] = filteredEntries.map(([groupId, meta], idx) => {
            const isWl = whitelistedSet.has(groupId);
            const subject = meta.subject ? String(meta.subject).trim() : 'Group';
            const participantCount = Array.isArray(meta.participants) ? meta.participants.length : meta.size || 0;
            const badge = isWl ? 'WHITELISTED' : 'NOT WHITELISTED';

            return {
                rank: idx + 1,
                title: subject,
                subtitle: `${participantCount} members • ${groupId}`,
                badge
            };
        });

        const totalGroups = groupEntries.length;
        const totalWl = groupEntries.filter(([id]) => whitelistedSet.has(id)).length;
        const totalUnwl = totalGroups - totalWl;
        const autoWlStatus = isAutoWhitelistEnabled() ? 'ENABLED' : 'DISABLED';

        const summaryTip = t('tools.whitelist.list_summary', {
            total: totalGroups,
            whitelisted: totalWl,
            unwhitelisted: totalUnwl,
            autoWl: autoWlStatus
        });

        const listOutput = renderCatalogCard(
            t('tools.whitelist.list_title', 'Available WhatsApp Groups'),
            '📋',
            catalogItems,
            summaryTip,
            t
        );

        await sock.sendMessage(jid, { text: listOutput }, { quoted: msg });
        return;
    }

    // =========================================================================
    // 2. SUBCOMMAND: ALL (.whitelistall / .addallgroups / .whitelist all)
    // =========================================================================
    if (subcommand === 'all') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        let participatingGroups: Record<string, any> = {};
        try {
            participatingGroups = await getCachedParticipatingGroups(sock);
        } catch (err) {
            console.error('[WhitelistTool] Failed to fetch participating groups:', err);
        }

        const groupEntries = Object.entries(participatingGroups).filter(
            ([id, meta]) => id && id.endsWith('@g.us') && meta
        );

        if (groupEntries.length === 0) {
            const noGroupsMsg = t('tools.whitelist.no_groups', 'The bot is not currently participating in any groups.');
            await sock.sendMessage(jid, { text: noGroupsMsg }, { quoted: msg });
            return;
        }

        const existingWhitelisted = await getAllWhitelistedGroups();
        const existingSet = new Set(existingWhitelisted);

        const toAdd = groupEntries.filter(([id]) => !existingSet.has(id));

        if (toAdd.length === 0) {
            const allAlreadyMsg = renderCard({
                title: t('tools.whitelist.all_title', 'Batch Whitelist Status'),
                icon: '✅',
                body: t('tools.whitelist.all_already_whitelisted', {
                    count: groupEntries.length
                }),
                fields: [
                    { label: 'Total Groups', value: groupEntries.length },
                    { label: 'Whitelisted', value: groupEntries.length },
                    { label: 'Auto-Whitelist', value: isAutoWhitelistEnabled() ? 'ENABLED' : 'DISABLED' }
                ],
                t
            });
            await sock.sendMessage(jid, { text: allAlreadyMsg }, { quoted: msg });
            return;
        }

        // Batch upsert into database
        await prisma.$transaction(
            toAdd.map(([groupId]) =>
                prisma.whitelistedGroup.upsert({
                    where: { jid: groupId },
                    update: {},
                    create: { jid: groupId, ownerJid: null }
                })
            )
        );

        const updatedCount = existingSet.size + toAdd.length;
        const successMsg = renderCard({
            title: t('tools.whitelist.all_success_title', 'Batch Whitelist Complete'),
            icon: '🎉',
            body: t('tools.whitelist.all_success_body', {
                added: toAdd.length
            }),
            fields: [
                { label: 'Newly Added', value: toAdd.length },
                { label: 'Previously Active', value: existingSet.size },
                { label: 'Total Whitelisted', value: updatedCount },
                { label: 'Auto-Whitelist on Join', value: isAutoWhitelistEnabled() ? 'ENABLED' : 'DISABLED' },
                { label: 'Auto-Archive on Join', value: isAutoArchiveEnabled() ? 'ENABLED' : 'DISABLED' }
            ],
            footer: '💡 Tip: Turn on auto-whitelisting with .whitelist auto on to whitelist new groups automatically.'
        });

        await sock.sendMessage(jid, { text: successMsg }, { quoted: msg });
        return;
    }

    // =========================================================================
    // 3. SUBCOMMAND: AUTO (.whitelist auto on|off)
    // =========================================================================
    if (subcommand === 'auto') {
        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        const action = subArgs[1]?.toLowerCase();
        if (action === 'archive' || action === 'autoarchive') {
            const archiveAction = subArgs[2]?.toLowerCase();
            if (
                archiveAction === 'on' ||
                archiveAction === 'enable' ||
                archiveAction === '1' ||
                archiveAction === 'true'
            ) {
                setAutoArchive(true);
                const msgCard = renderCard({
                    title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
                    icon: '⚡',
                    body: t('tools.autoarchive.enabled_body', 'Auto-archiving on group join has been *ENABLED*.'),
                    fields: [
                        { label: 'Status', value: 'ENABLED' },
                        { label: 'Updated By', value: callerJid || 'Bot Owner' }
                    ],
                    t
                });
                await sock.sendMessage(jid, { text: msgCard }, { quoted: msg });
                return;
            }
            if (
                archiveAction === 'off' ||
                archiveAction === 'disable' ||
                archiveAction === '0' ||
                archiveAction === 'false'
            ) {
                setAutoArchive(false);
                const msgCard = renderCard({
                    title: t('tools.autoarchive.title', 'Auto-Archive Settings'),
                    icon: '⏸️',
                    body: t('tools.autoarchive.disabled_body', 'Auto-archiving on group join has been *DISABLED*.'),
                    fields: [
                        { label: 'Status', value: 'DISABLED' },
                        { label: 'Updated By', value: callerJid || 'Bot Owner' }
                    ],
                    t
                });
                await sock.sendMessage(jid, { text: msgCard }, { quoted: msg });
                return;
            }
        }
        if (action === 'on' || action === 'enable' || action === '1' || action === 'true') {
            setAutoWhitelist(true);
            const msgCard = renderCard({
                title: t('tools.whitelist.auto_title', 'Auto-Whitelist Settings'),
                icon: '⚡',
                body: t(
                    'tools.whitelist.auto_enabled_body',
                    'Auto-whitelisting on group join has been *ENABLED*.\n\nEvery group the bot joins or is currently in will automatically be whitelisted without needing .addgroup.'
                ),
                fields: [
                    { label: 'Status', value: 'ENABLED' },
                    { label: 'Updated By', value: callerJid || 'Bot Owner' }
                ],
                t
            });
            await sock.sendMessage(jid, { text: msgCard }, { quoted: msg });
            return;
        }

        if (action === 'off' || action === 'disable' || action === '0' || action === 'false') {
            setAutoWhitelist(false);
            const msgCard = renderCard({
                title: t('tools.whitelist.auto_title', 'Auto-Whitelist Settings'),
                icon: '⏸️',
                body: t(
                    'tools.whitelist.auto_disabled_body',
                    'Auto-whitelisting on group join has been *DISABLED*.\n\nNew groups will require manual approval using .addgroup or .whitelistall.'
                ),
                fields: [
                    { label: 'Status', value: 'DISABLED' },
                    { label: 'Updated By', value: callerJid || 'Bot Owner' }
                ],
                t
            });
            await sock.sendMessage(jid, { text: msgCard }, { quoted: msg });
            return;
        }

        // Display current auto-whitelist status
        const currentStatus = isAutoWhitelistEnabled() ? 'ENABLED' : 'DISABLED';
        const statusCard = renderCard({
            title: t('tools.whitelist.auto_title', 'Auto-Whitelist Settings'),
            icon: '⚙️',
            fields: [
                { label: 'Current Setting', value: currentStatus },
                { label: 'Command Syntax', value: '.whitelist auto <on|off>' }
            ],
            footer: '💡 Example: .whitelist auto on',
            t
        });
        await sock.sendMessage(jid, { text: statusCard }, { quoted: msg });
        return;
    }

    // =========================================================================
    // 4. SUBCOMMAND: ADD (.whitelist add [jid])
    // =========================================================================
    if (subcommand === 'add') {
        const targetJid = subArgs[1] || (typeof args.target === 'string' ? args.target : '') || jid;
        if (!targetJid || !targetJid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: t('core.group_only') }, { quoted: msg });
            return;
        }

        const already = await isGroupWhitelisted(targetJid);
        if (already) {
            await sock.sendMessage(jid, { text: t('core.group_already_whitelisted') }, { quoted: msg });
            return;
        }

        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        const ok = await addGroup(targetJid, null);
        if (ok) {
            await sock.sendMessage(jid, { text: t('core.group_add_success') }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, { text: t('core.group_add_failed') }, { quoted: msg });
        }
        return;
    }

    // =========================================================================
    // 5. SUBCOMMAND: REMOVE / DEL (.whitelist remove [jid])
    // =========================================================================
    if (subcommand === 'remove' || subcommand === 'del') {
        const targetJid = subArgs[1] || (typeof args.target === 'string' ? args.target : '') || jid;
        if (!targetJid || !targetJid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { text: t('core.group_only') }, { quoted: msg });
            return;
        }

        const isWl = await isGroupWhitelisted(targetJid);
        if (!isWl) {
            await sock.sendMessage(jid, { text: t('core.group_not_whitelisted') }, { quoted: msg });
            return;
        }

        if (!isOwner) {
            await sock.sendMessage(jid, { text: t('core.unauthorized') }, { quoted: msg });
            return;
        }

        const ok = await removeGroup(targetJid);
        if (ok) {
            await sock.sendMessage(jid, { text: t('core.group_remove_success') }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, { text: t('core.group_add_failed') }, { quoted: msg });
        }
        return;
    }

    // =========================================================================
    // 6. DEFAULT / STATUS DASHBOARD (.whitelist / .whitelist status)
    // =========================================================================
    let participatingCount = 0;
    try {
        const participatingGroups = await getCachedParticipatingGroups(sock);
        participatingCount = Object.keys(participatingGroups).filter((id) => id.endsWith('@g.us')).length;
    } catch {
        // Ignore error
    }

    const whitelistedGroups = await getAllWhitelistedGroups();
    const isCurrentWhitelisted = jid.endsWith('@g.us') ? await isGroupWhitelisted(jid) : false;
    const autoWlStatus = isAutoWhitelistEnabled() ? 'ENABLED' : 'DISABLED';

    const statusCard = renderCard({
        title: t('tools.whitelist.dashboard_title', 'Group Whitelist Suite'),
        icon: '🛡️',
        subtitle: jid.endsWith('@g.us')
            ? `Current Chat: ${isCurrentWhitelisted ? renderBadge('WHITELISTED') : renderBadge('NOT WHITELISTED')}`
            : 'Global Whitelist Management',
        fields: [
            { label: 'Participating Groups', value: participatingCount },
            { label: 'Whitelisted Groups', value: whitelistedGroups.length },
            { label: 'Auto-Whitelist on Join', value: autoWlStatus },
            { label: 'Auto-Archive on Join', value: isAutoArchiveEnabled() ? 'ENABLED' : 'DISABLED' }
        ],
        sections: [
            {
                title: 'Available Commands',
                items: [
                    { icon: '📋', label: '.listgroup', value: 'Show all available groups with status' },
                    { icon: '⚡', label: '.whitelistall', value: 'Batch-whitelist all participating groups' },
                    { icon: '⚙️', label: '.whitelist auto <on|off>', value: 'Toggle auto-whitelisting on group join' },
                    { icon: '📦', label: '.auto archive <on|off>', value: 'Toggle auto-archiving on group join' },
                    { icon: '➕', label: '.addgroup', value: 'Whitelist current group' },
                    { icon: '➖', label: '.delgroup', value: 'Remove current group from whitelist' }
                ]
            }
        ],
        footer: '💡 Cosmos Enterprise Group Access Control',
        t
    });

    await sock.sendMessage(jid, { text: statusCard }, { quoted: msg });
}

export default { definition, execute } as ToolModule;
