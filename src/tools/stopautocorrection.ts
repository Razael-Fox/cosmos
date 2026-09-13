import { ToolDefinition, ToolContext } from './types.js';
import { disableAutoCorrection, isAutoCorrectionEnabled } from '#utils/autoCorrection.js';

export const definition: ToolDefinition = {
    name: 'stopautocorrection',
    title: 'Stop AI Auto-Correction',
    category: 'AI & Correction',
    aliases: ['.stopautocorrection', '.stopautocorrect', '.disableautocorrect', '.disableautocorrection'],
    description: 'Disables automated AI message auto-correction via OpenRouter for this chat.',
    descriptionKey: 'tools.commands.stopautocorrection.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    if (!isAutoCorrectionEnabled(ctx.jid)) {
        return ctx.t('utilities.autocorrection.not_active');
    }
    await disableAutoCorrection(ctx.jid);
    return ctx.t('utilities.autocorrection.deactivated');
}
