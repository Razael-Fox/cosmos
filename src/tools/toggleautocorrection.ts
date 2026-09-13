import { ToolDefinition, ToolContext } from './types.js';
import { toggleAutoCorrection } from '#utils/autoCorrection.js';

export const definition: ToolDefinition = {
    name: 'toggleautocorrection',
    title: 'Toggle AI Auto-Correction',
    category: 'AI & Correction',
    aliases: ['.toggleautocorrection', '.autocorrect', '.autocorrection', '.autotyo'],
    description: 'Toggles automated AI message auto-correction via OpenRouter for this chat.',
    descriptionKey: 'tools.commands.toggleautocorrection.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const isEnabled = await toggleAutoCorrection(ctx.jid);
    if (isEnabled) {
        return ctx.t('utilities.autocorrection.activated');
    } else {
        return ctx.t('utilities.autocorrection.deactivated');
    }
}
