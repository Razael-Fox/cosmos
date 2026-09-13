import { ToolModule, ToolContext } from './types.js';
import { casinoState } from '../utils/casino.js';
import { getAllWhitelistedGroups } from '../db.js';

const feverTimeTool: ToolModule = {
    definition: {
        name: 'fevertime',
        description: 'Trigger a global Fever Time event for 15 minutes.',
        descriptionKey: 'tools.commands.fevertime.description',
        category: 'Casino',
        owner: true,
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
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
                conversation: '🔥 Cosmos EVENT ANNOUNCEMENT 🔥'
            }
        };

        const text =
            `🚨 *FEVER TIME IS ACTIVE!* 🚨\n\n` +
            `The global win rate has been massively boosted for the next 15 minutes!\n` +
            `This is the best time to gamble and win big!\n\n` +
            `_Use .slot, .coinflip, or .dice to start playing!_`;

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const whitelistedGroups = await getAllWhitelistedGroups();
        for (const groupJid of whitelistedGroups) {
            await sock.sendMessage(groupJid, { text }, { quoted: fakeCosmosQuote as any }).catch(() => {});
        }

        // React to acknowledge success without sending output text to the triggerer (if in PM)
        if (msg.key.remoteJid) {
            await sock.sendMessage(msg.key.remoteJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
        }
    }
};

export default feverTimeTool;
