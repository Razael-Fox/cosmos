import { stopLyrics } from '#utils/lyricsPlayer.js';
import { ToolDefinition, ToolContext } from './types.js';
import { getTranslator } from '#utils/i18n.js';

export const definition: ToolDefinition = {
    name: 'stoplyrics',
    title: 'Stop Lyrics Player',
    category: 'Music & Lyrics',
    aliases: ['.stoplyrics', '.slyrics'],
    description: 'Stops ongoing lyrics playback in this chat.',
    descriptionKey: 'tools.commands.stoplyrics.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    try {
        const result = await stopLyrics(ctx.jid, ctx.sock, t);
        return result;
    } catch (err) {
        console.error('Error in stoplyrics tool:', err);
        return t('media.stoplyrics.error');
    }
}
