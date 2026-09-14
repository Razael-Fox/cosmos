import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import {
    requestPairing,
    stopSubBot,
    startSubBot,
    deleteSubBot,
    getSubBotStatus,
    listAllSubBots,
    getCleanNumber
} from '#services/subBotService.js';
import { loadConfig } from '#services/subBotConfigService.js';
import { dbContext } from '#db.js';
import { renderCard } from '#utils/uiFormatter.js';
import dotenv from 'dotenv';

dotenv.config();

export const definition: ToolDefinition = {
    name: 'subbot',
    title: 'Sub-Bot Manager',
    category: 'System',
    aliases: ['.subbot', '.jadibot'],
    description: 'Pair and manage your own WhatsApp number as an autonomous sub-bot instance.',
    descriptionKey: 'tools.commands.subbot.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Sub-bot command query (e.g. pair <number> <code>, status, stop, start, delete, list)'
            }
        },
        required: []
    }
};

function formatUptime(seconds: number): string {
    if (seconds <= 0) return '0s';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const rawQuery = (args.query || '').trim();
    const parts = rawQuery.split(/\s+/).filter(Boolean);
    const action = parts[0]?.toLowerCase() || '';

    const senderJid = getSenderJid(ctx.msg);
    const senderClean = cleanId(senderJid);
    const store = dbContext.getStore();
    const currentSessionId = store?.sessionId || 'default';
    const primaryAdmin = cleanId(process.env.BOT_PHONE_NUMBER);

    // Anti-recursion guard: sub-bots cannot pair new sub-bots
    if (action === 'pair') {
        if (currentSessionId !== 'default') {
            return renderCard({
                title: ctx.t('tools.subbot.anti_recursion_title'),
                icon: '⛔',
                headerStyle: 'heavy',
                body: ctx.t('tools.subbot.anti_recursion_desc')
            });
        }

        const targetNumber = parts[1] || senderClean;
        const methodArg = parts[2]?.toLowerCase();
        const method: 'code' | 'qr' = methodArg === 'qr' ? 'qr' : 'code';

        const result = await requestPairing(targetNumber, method, senderJid, ctx.jid, ctx.sock, ctx.msg, ctx.t);

        if (result) return result;
        return;
    }

    if (action === 'status') {
        let targetNumber = parts[1] ? getCleanNumber(parts[1]) : '';
        if (!targetNumber) {
            if (currentSessionId !== 'default') {
                targetNumber = currentSessionId.replace(/^sub_/, '');
            } else {
                targetNumber = senderClean;
            }
        }

        const status = getSubBotStatus(targetNumber);
        const modeText =
            status.config.mode === 'self' ? ctx.t('tools.subbot.mode_self') : ctx.t('tools.subbot.mode_public');

        return renderCard({
            title: ctx.t('tools.subbot.status_title'),
            icon: '📊',
            headerStyle: 'heavy',
            fields: [
                { label: ctx.t('tools.subbot.device_number'), value: `+${status.phoneNumber}`, boldLabel: true },
                {
                    label: ctx.t('tools.subbot.status_label'),
                    value: status.isConnected ? '[ ✅ ONLINE ]' : '[ ❌ OFFLINE ]'
                },
                { label: ctx.t('tools.subbot.mode_label'), value: modeText },
                { label: ctx.t('tools.subbot.uptime_label'), value: formatUptime(status.uptimeSec) }
            ],
            tip: 'Use .config to adjust feature toggles and API keys.'
        });
    }

    if (action === 'stop') {
        let targetNumber = parts[1] ? getCleanNumber(parts[1]) : '';
        if (!targetNumber) {
            if (currentSessionId !== 'default') {
                targetNumber = currentSessionId.replace(/^sub_/, '');
            } else {
                targetNumber = senderClean;
            }
        }

        const config = loadConfig(targetNumber);
        const isOwner = senderClean === cleanId(config.ownerJid) || (primaryAdmin && senderClean === primaryAdmin);

        if (!isOwner) {
            return ctx.t('tools.config.not_owner');
        }

        const stopped = await stopSubBot(targetNumber);
        if (stopped) {
            return ctx.t('tools.subbot.stop_success', { number: targetNumber });
        }
        return `Sub-bot +${targetNumber} is not currently active.`;
    }

    if (action === 'start') {
        let targetNumber = parts[1] ? getCleanNumber(parts[1]) : '';
        if (!targetNumber) {
            if (currentSessionId !== 'default') {
                targetNumber = currentSessionId.replace(/^sub_/, '');
            } else {
                targetNumber = senderClean;
            }
        }

        const config = loadConfig(targetNumber);
        const isOwner = senderClean === cleanId(config.ownerJid) || (primaryAdmin && senderClean === primaryAdmin);

        if (!isOwner) {
            return ctx.t('tools.config.not_owner');
        }

        const started = await startSubBot(targetNumber);
        if (started) {
            return ctx.t('tools.subbot.start_success', { number: targetNumber });
        }
        return `Sub-bot +${targetNumber} is already active or missing database files.`;
    }

    if (action === 'delete') {
        let targetNumber = parts[1] ? getCleanNumber(parts[1]) : '';
        if (!targetNumber) {
            if (currentSessionId !== 'default') {
                targetNumber = currentSessionId.replace(/^sub_/, '');
            } else {
                targetNumber = senderClean;
            }
        }

        const config = loadConfig(targetNumber);
        const isOwner = senderClean === cleanId(config.ownerJid) || (primaryAdmin && senderClean === primaryAdmin);

        if (!isOwner) {
            return ctx.t('tools.config.not_owner');
        }

        await deleteSubBot(targetNumber);
        return ctx.t('tools.subbot.delete_success');
    }

    if (action === 'list') {
        const isPrimaryAdmin = primaryAdmin && senderClean === primaryAdmin;
        if (!isPrimaryAdmin) {
            return ctx.t('tools.subbot.admin_only_list');
        }

        const list = listAllSubBots();
        if (list.length === 0) {
            return 'No sub-bot instances configured on this host.';
        }

        const items = list.map((b, idx) => ({
            label: `${idx + 1}. +${b.phoneNumber}`,
            value: b.isConnected ? `[ ✅ ONLINE ] (${formatUptime(b.uptimeSec)})` : `[ ❌ OFFLINE ]`
        }));

        return renderCard({
            title: ctx.t('tools.subbot.dashboard_title'),
            icon: '📋',
            headerStyle: 'heavy',
            sections: [
                {
                    title: `Total Instances: ${list.length}`,
                    items
                }
            ],
            tip: 'Use .subbot status <number> for detailed metrics.'
        });
    }

    // Default dashboard overview
    return renderCard({
        title: ctx.t('tools.subbot.dashboard_title'),
        icon: '🤖',
        headerStyle: 'heavy',
        body: 'Cosmos Autonomous Multi-Device Sub-Bot Engine',
        sections: [
            {
                title: 'Available Commands',
                items: [
                    { label: '.subbot pair <number> <code>', value: 'Link device via 8-digit code' },
                    { label: '.subbot pair <number> <qr>', value: 'Link device via dynamic QR scan' },
                    { label: '.subbot status', value: 'Check connection and uptime' },
                    { label: '.subbot stop', value: 'Disconnect sub-bot' },
                    { label: '.subbot start', value: 'Reconnect existing sub-bot' },
                    { label: '.subbot delete', value: 'Permanently remove sub-bot' }
                ]
            }
        ],
        tip: 'Send .cancel at any time during pairing to abort.'
    });
}
