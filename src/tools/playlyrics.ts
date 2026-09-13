import { playLyrics } from '#utils/lyricsPlayer.js';
import { ToolDefinition, ToolContext } from './types.js';
import { getTranslator } from '#utils/i18n.js';

export const definition: ToolDefinition = {
    name: 'playlyrics',
    title: 'Play Music with Lyrics',
    category: 'Music & Audio',
    aliases: ['.playlyrics', '.lirik', '.lyrics'],
    description:
        'Starts automated lyrics playback for the requested song. Fetches synchronized lyrics online if not found locally.',
    descriptionKey: 'tools.commands.playlyrics.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: "Format: 'song name' | [speedMultiplier]"
            }
        },
        required: ['query']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const query = args.query ? String(args.query).trim() : '';
    if (!query) {
        return t('media.playlyrics.invalid_format');
    }

    let songName: string;
    let multiplierStr = '';

    // 1. Check if pipe separator exists
    if (query.includes('|')) {
        const parts = query.split('|');
        const filePart = parts[0].trim();
        multiplierStr = parts[1].trim();

        // Extract filename from quotes if present
        const match = filePart.match(/^(['"])(.*?)\1$/);
        if (match) {
            songName = match[2].trim();
        } else {
            songName = filePart;
        }
    } else {
        // If no '|', check if the whole query is quoted
        const match = query.match(/^(['"])(.*?)\1$/);
        if (match) {
            songName = match[2].trim();
        } else {
            songName = query;
        }
    }

    let speedMultiplier = 2; // Default multiplier is 2
    if (multiplierStr) {
        const val = parseFloat(multiplierStr);
        if (!isNaN(val) && val > 0) {
            speedMultiplier = val;
        } else {
            return t('media.playlyrics.multiplier_positive');
        }
    }

    try {
        const result = await playLyrics(ctx.jid, ctx.sock, songName, speedMultiplier, t);
        return result;
    } catch (err) {
        console.error('Error in playlyrics tool:', err);
        return t('media.playlyrics.playback_error');
    }
}
