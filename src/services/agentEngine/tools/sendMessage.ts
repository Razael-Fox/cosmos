import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { EphemeralTokenStore } from '../tokenStore.js';

export const sendMessageTool: AgentTool = {
    name: 'send_message',
    description: 'Sends a WhatsApp text message to a recipient using their zero-knowledge recipientToken.',
    policy: ToolAiPolicy.UTILITY,
    parameters: {
        type: 'object',
        properties: {
            recipientToken: {
                type: 'string',
                description: 'The ephemeral contact token (e.g., contact_ref_...) representing the recipient.'
            },
            message: {
                type: 'string',
                description: 'The exact text message to dispatch to the recipient.'
            }
        },
        required: ['recipientToken', 'message']
    },
    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const recipientToken = typeof args.recipientToken === 'string' ? args.recipientToken.trim() : '';
        const message = typeof args.message === 'string' ? args.message.trim() : '';

        if (!recipientToken || !message) {
            return {
                success: false,
                error: 'Missing required parameters: recipientToken and message.'
            };
        }

        // Detokenize token in server RAM
        const realJid = EphemeralTokenStore.resolveToken(recipientToken, ctx.callerJid, 'send_message');
        if (!realJid) {
            return {
                success: false,
                error: 'Recipient token is invalid, expired, or belongs to another user.'
            };
        }

        try {
            await ctx.sock.sendPresenceUpdate('composing', realJid);
            const sentMsg = await ctx.sock.sendMessage(realJid, { text: message });

            // Invalidate token upon terminal execution
            EphemeralTokenStore.consumeToken(recipientToken, ctx.callerJid);

            return {
                success: true,
                data: {
                    messageId: sentMsg?.key?.id,
                    dispatched: true,
                    recipientToken
                }
            };
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[sendMessageTool] Failed to send message to ${realJid}:`, err);
            return {
                success: false,
                error: `Failed to dispatch message: ${errorMsg}`
            };
        }
    }
};
