import { ToolModule, ToolContext } from './types.js';
import { CosmosAgentEngine } from '../services/agentEngine/index.js';

const saraTool: ToolModule = {
    definition: {
        name: 'sara',
        aliases: ['ai'],
        description:
            'Invoke Sara, the intelligent AI assistant, to chat, query information, or perform permitted actions.',
        descriptionKey: 'tools.commands.sara.description',
        category: 'Utility',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'Question, instruction, or request for Sara AI.'
                }
            },
            required: ['prompt']
        }
    },
    execute: async (args: Record<string, unknown>, ctx: ToolContext) => {
        const { msg, sock } = ctx;
        const chatJid = msg.key.remoteJid;
        if (!chatJid) return;

        const promptText =
            typeof args.prompt === 'string'
                ? args.prompt.trim()
                : typeof args.rawText === 'string'
                  ? args.rawText.trim()
                  : '';

        if (!promptText) {
            await sock.sendMessage(
                chatJid,
                {
                    text: '👋 Hello! I am Sara, your AI assistant. How can I assist you today?\nExample: *.sara please check my current balance* or *.sara please send a message to Mom saying I will be late.*'
                },
                { quoted: msg }
            );
            return;
        }

        const locale = ctx.t && ctx.t('core.lang') === 'id' ? 'id' : 'en';
        await CosmosAgentEngine.processMessage(sock, msg, chatJid, promptText, locale);
        // Returning undefined prevents message echo in the main handler pipeline
        return;
    }
};

export default saraTool;
