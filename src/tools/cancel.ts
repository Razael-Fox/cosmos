import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { cancelActiveSession } from '#utils/cancellationManager.js';
import { getTranslator } from '#utils/i18n.js';

export const definition: ToolDefinition = {
    name: 'cancel',
    title: 'Cancel Operation',
    category: 'General',
    aliases: ['batal', 'abort'],
    description:
        'Cancel an active multi-step operation, interactive prompt, or pending confirmation in the current chat.',
    descriptionKey: 'tools.commands.cancel.description',
    parameters: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Optional reason for cancellation.'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    const cancelled = await cancelActiveSession(senderJid, ctx.jid, ctx.sock, ctx.msg);
    if (cancelled) {
        return cancelled;
    }

    return t('tools.cancel.no_active_session');
}

const cancelTool: ToolModule = {
    definition,
    execute
};

export default cancelTool;
