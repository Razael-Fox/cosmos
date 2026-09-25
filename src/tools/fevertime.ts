import { ToolModule, ToolContext } from './types.js';
import { casinoState } from '../utils/casino.js';
import { getAllWhitelistedGroups } from '../db.js';
import { renderCard } from '../utils/uiFormatter.js';

const feverTimeTool: ToolModule = {
    definition: {
        name: 'fevertime',
        title: 'Fever Time',
        displayNames: { en: 'fever time', id: 'fever time' },
        aliases: ['.fever time', 'fever time', '.fevertime', 'fevertime', 'fever'],
        description: 'Trigger a global Fever Time event for 15 minutes.',
        descriptionKey: 'tools.commands.fevertime.description',
        category: 'Casino',
        owner: true,
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    execute: async (_args: Record<string, any>, ctx: ToolContext) => {
        const { sock, msg } = ctx;

        const durationMs = 15 * 60 * 1000;
        casinoState.feverTimeEnd = Date.now() + durationMs;

        const fakeCosmosQuote = {
            key: {
                remoteJid: '0@s.whatsapp.net',
                fromMe: false,
                id: 'COSMOS_FEVER_MSG',
                participant: '0@s.whatsapp.net'
            },
            message: {
                conversation: ctx.t('tools.fevertime.quote_announcement')
            }
        };

        const text = renderCard({
            title: ctx.t('tools.fevertime.title', 'FEVER TIME IS ACTIVE!'),
            icon: '🚨',
            headerStyle: 'heavy',
            subtitle: ctx.t('tools.fevertime.subtitle', 'Global Win Rate Boosted'),
            body: ctx.t(
                'tools.fevertime.description',
                'The global win rate has been massively boosted for the next 15 minutes! This is the best time to gamble and win big!'
            ),
            fields: [
                {
                    icon: '⏱️',
                    label: ctx.t('tools.fevertime.duration_label', 'Duration'),
                    value: ctx.t('tools.fevertime.duration_value', '15 Minutes')
                },
                {
                    icon: '🔥',
                    label: ctx.t('tools.fevertime.status_label', 'Status'),
                    value: ctx.t('tools.fevertime.status_boosted', 'MASSIVE BOOST ACTIVE')
                }
            ],
            tips: [ctx.t('tools.fevertime.tip', 'Use .slot, .coinflip, or .dice to start playing!')]
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const whitelistedGroups = await getAllWhitelistedGroups();
        for (const groupJid of whitelistedGroups) {
            await sock.sendMessage(groupJid, { text }, { quoted: fakeCosmosQuote as any }).catch(() => {});
        }

        if (msg.key.remoteJid) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
        }
    }
};

export default feverTimeTool;
