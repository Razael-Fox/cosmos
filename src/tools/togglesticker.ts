import { ToolDefinition, ToolContext } from './types.js';
import { toggleAutoSticker } from '#utils/autoSticker.js';

export const definition: ToolDefinition = {
    name: 'togglesticker',
    title: 'Enable Auto-Sticker',
    category: 'Media & Stickers',
    aliases: [
        '.togglesticker',
        '.autosticker',
        '.autostiker',
        '.togglestickermaker',
        '.togsticker',
        '.tglsticker',
        '.tgls',
        '.asticker',
        '.astiker'
    ],
    description: 'Enables or disables the Auto Sticker Maker feature for this chat.',
    descriptionKey: 'tools.commands.togglesticker.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const isEnabled = await toggleAutoSticker(ctx.jid);
    if (isEnabled) {
        return ctx.t('utilities.autosticker.enabled');
    } else {
        return ctx.t('utilities.autosticker.disabled');
    }
}
