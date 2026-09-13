import { ToolDefinition, ToolContext } from './types.js';
import { toggleOfflineAi } from '#utils/offlineAi.js';

export const definition: ToolDefinition = {
    name: 'toggleofflineai',
    title: 'Toggle Offline AI Responder',
    category: 'AI & Correction',
    aliases: ['.toggleofflineai', '.offlineai', '.airesponder'],
    description:
        'Toggles the automated offline AI responder. When enabled, the AI will casually reply to messages while you are offline.',
    descriptionKey: 'tools.commands.toggleofflineai.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const isEnabled = toggleOfflineAi();
    if (isEnabled) {
        return ctx.t('utilities.offlineai.activated');
    } else {
        return ctx.t('utilities.offlineai.deactivated');
    }
}
