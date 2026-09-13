import { ToolDefinition, ToolContext } from './types.js';
import { disableAutoSticker, isAutoStickerEnabled } from '#utils/autoSticker.js';

export const definition: ToolDefinition = {
    name: 'stoptogglesticker',
    title: 'Disable Auto-Sticker',
    category: 'Media & Stickers',
    aliases: [
        '.stoptogglesticker',
        '.stoptogglestickermaker',
        '.stopautosticker',
        '.stopautostiker',
        '.stoptogsticker',
        '.stoptglsticker',
        '.stoptgls',
        '.stopasticker',
        '.stopastiker'
    ],
    description: 'Disables the Auto Sticker Maker feature for this chat.',
    descriptionKey: 'tools.commands.stoptogglesticker.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    if (!isAutoStickerEnabled(ctx.jid)) {
        return ctx.t('utilities.autosticker.not_active');
    }
    await disableAutoSticker(ctx.jid);
    return ctx.t('utilities.autosticker.disabled');
}
