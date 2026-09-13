import { ToolDefinition, ToolContext } from './types.js';
import { enableAutoCorrection, isAutoCorrectionEnabled } from '#utils/autoCorrection.js';

export const definition: ToolDefinition = {
    name: 'startautocorrection',
    title: 'Start AI Auto-Correction',
    category: 'AI & Correction',
    aliases: ['.startautocorrection', '.startautocorrect', '.enableautocorrect', '.enableautocorrection'],
    description: 'Enables automated AI message auto-correction via OpenRouter for this chat.',
    descriptionKey: 'tools.commands.startautocorrection.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    if (isAutoCorrectionEnabled(ctx.jid)) {
        return ctx.t('utilities.autocorrection.already_active');
    }
    await enableAutoCorrection(ctx.jid);
    return ctx.t('utilities.autocorrection.activated');
}
