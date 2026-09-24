import { ToolDefinition, ToolContext } from './types.js';
import { fetchRule34Video, Rule34VideoResult } from '#services/rule34Service.js';
import { isNsfwEnabled } from '#utils/nsfwConfig.js';
import menuService from '#services/menuService.js';
import { unwrapMonospace } from '#utils/monospace.js';

export const definition: ToolDefinition = {
    name: 'rule34',
    title: 'Rule34 Video Search',
    category: 'Media & Stickers',
    aliases: ['.rule34', '.r34', '.hentai'],
    description:
        'Searches and retrieves non-AI NSFW videos (15-30s) from Rule34 based on specified tags, or fetches a random video if called without parameters.',
    descriptionKey: 'tools.commands.rule34.description',
    parameters: {
        type: 'object',
        properties: {
            tags: {
                type: 'string',
                description: 'Optional space-delimited booru search tags. Omit to fetch a random video.'
            }
        },
        required: []
    }
};

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | undefined> {
    const jid = ctx.jid;

    // 1. Group Chat Gate: Check if feature is enabled in this group
    if (jid.endsWith('@g.us') && !isNsfwEnabled(jid)) {
        return ctx.t('tools.nsfw.feature_disabled_group');
    }

    // 2. Parse arguments and check for tutorial / help redirection
    const rawInput = typeof args?.tags === 'string' ? args.tags.trim() : '';
    const { text: unwrapped } = unwrapMonospace(rawInput);
    const cleanInput = unwrapped.trim();
    const lowerInput = cleanInput.toLowerCase();

    if (lowerInput === 'help' || lowerInput === 'tutorial' || lowerInput === 'panduan') {
        const lang = ctx.lang || 'id';
        return menuService.getTutorial('nsfw', lang, ctx.t, '.');
    }

    // 3. Determine zero-parameter quick-fetch mode
    const isZeroParam = cleanInput.length === 0;

    // 4. Processing Reaction: ⏳
    try {
        await ctx.sock.sendMessage(jid, { react: { text: '⏳', key: ctx.msg.key } });
    } catch {
        /* ignore reaction errors */
    }

    // 5. Fetch video from Rule34 API service
    let result: Rule34VideoResult;
    try {
        result = await fetchRule34Video(cleanInput, isZeroParam);
    } catch (err: unknown) {
        try {
            await ctx.sock.sendMessage(jid, { react: { text: '❌', key: ctx.msg.key } });
        } catch {
            /* ignore */
        }

        const message = err instanceof Error ? err.message : String(err);
        switch (message) {
            case 'BLACKLISTED_TAG':
                return ctx.t('tools.nsfw.blacklisted_tag');
            case 'NO_POSTS_FOUND':
                return ctx.t('tools.nsfw.no_results');
            case 'NO_VIDEO_FOUND':
                return ctx.t('tools.nsfw.no_video_found');
            case 'NO_DURATION_MATCH':
                return ctx.t('tools.nsfw.no_video_duration_match');
            case 'FILE_TOO_LARGE':
                return ctx.t('tools.nsfw.file_too_large');
            case 'FETCH_FAILED':
            default:
                return ctx.t('tools.nsfw.fetch_failed');
        }
    }

    // 6. Build localized caption
    let ratingText: string;
    if (result.rating === 'explicit') {
        ratingText = ctx.t('tools.nsfw.rating_explicit');
    } else if (result.rating === 'questionable') {
        ratingText = ctx.t('tools.nsfw.rating_questionable');
    } else {
        ratingText = ctx.t('tools.nsfw.rating_safe');
    }

    let tagsText = result.tags
        .slice(0, 8)
        .map((t) => `#${t}`)
        .join(' ');
    if (result.resolvedAliases && result.resolvedAliases.length > 0) {
        const aliasNotes = result.resolvedAliases.map((a) => `${a.resolved} (from "${a.original}")`).join(', ');
        tagsText = `${tagsText}\n🔍 *Resolved:* ${aliasNotes}`;
    }

    const mainCaption = ctx.t('tools.nsfw.video_caption_template', {
        id: result.id,
        duration: result.duration,
        score: result.score,
        rating: ratingText,
        tags: tagsText
    });
    const tip = ctx.t('tools.nsfw.tip_how_to_search', { prefix: '.' });
    const fullCaption = `${mainCaption}${tip}`;

    // 7. Dispatch video and update reaction to ✅
    try {
        await ctx.sock.sendMessage(
            jid,
            {
                video: result.videoBuffer,
                caption: fullCaption,
                mimetype: 'video/mp4'
            },
            { quoted: ctx.msg }
        );
        await ctx.sock.sendMessage(jid, { react: { text: '✅', key: ctx.msg.key } });
    } catch (err: unknown) {
        console.error('[Rule34Tool] Failed to dispatch video message:', err);
        try {
            await ctx.sock.sendMessage(jid, { react: { text: '❌', key: ctx.msg.key } });
        } catch {
            /* ignore */
        }
        return ctx.t('tools.nsfw.fetch_failed');
    }

    return undefined;
}

export default { definition, execute };
