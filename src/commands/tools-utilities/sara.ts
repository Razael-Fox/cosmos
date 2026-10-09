import { ToolModule, ToolContext } from '../types.js';
import { CosmosAgentEngine } from '#services/agent/index.js';
import { AgentToolRegistry } from '#services/agent/tools/registry.js';
import { toolsHandler } from '#handlers/commandHandler.js';
import { getTranslator } from '#lib/i18n.js';

/**
 * Interrogative/request verbs that signal a genuine prompt (Issue #71, Step 3).
 * ponytail: small static word list, false negatives route to the AI (harmless),
 * false positives only forward a short message; widen the list if complaints appear.
 */
const INTENT_VERB_PATTERN =
    /\b(what|how|tell|explain|who|why|when|where|translate|help|check|show|send|make|find|summarize|list|write|draft|describe|create|apa|bagaimana|gimana|siapa|kenapa|mengapa|kapan|dimana|tolong|jelaskan|terjemahkan|cek|lihat|kirim|buat|cari|ringkas|rangkum|tulis)\b/i;

/**
 * Returns true when a prompt is a short casual fragment (≤ 3 tokens, no
 * question mark, no request verb) rather than a genuine AI request.
 */
export function isCasualFragment(promptText: string): boolean {
    const tokenCount = promptText.split(/\s+/).length;
    return tokenCount <= 3 && !promptText.includes('?') && !INTENT_VERB_PATTERN.test(promptText);
}

/**
 * True when the prompt opens with a registered agent tool or dot-command
 * (e.g. `.sara hidetag hello`). Short imperative invocations are actionable
 * even though the casual gate above would eat them (≤3 tokens, no verb).
 * Longest-prefix over the first two words, mirroring the message handler.
 */
export function opensWithRegisteredTool(promptText: string): boolean {
    const words = promptText.toLowerCase().split(/\s+/).filter(Boolean);
    for (let len = Math.min(2, words.length); len >= 1; len--) {
        const candidate = words.slice(0, len).join(' ');
        if (AgentToolRegistry.getTool(candidate)) return true;
        if (toolsHandler.getTool(candidate)) return true;
    }
    return false;
}

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

        // Confidence gate (Issue #71, Step 3): a bare fragment such as
        // `.ai is useless` (≤ 3 tokens, no question mark, no request verb) is
        // casual prose, not a prompt — ask for clarification instead of
        // forwarding it to the AI engine. Prompts that open with a registered
        // tool (`.sara hidetag hello`) are always actionable, never casual.
        if (promptText && isCasualFragment(promptText) && !opensWithRegisteredTool(promptText)) {
            const t = ctx.t || getTranslator('en');
            await sock.sendMessage(chatJid, { text: t('tools.sara.clarify') }, { quoted: msg });
            return;
        }

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
