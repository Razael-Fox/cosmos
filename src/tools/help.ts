import { ToolDefinition, ToolContext } from './types.js';
import { getTranslator } from '../utils/i18n.js';
import { getMenuBannerBuffer } from '../utils/menuAssets.js';
import menuService from '../services/menuService.js';
import {
    formatDashboardHeader,
    formatCategoryOverview,
    formatCategoryCommands,
    formatAllCommands,
    formatCommandDetail,
    formatNotFound
} from '../utils/menuFormatter.js';
import { cleanId, formatMentions } from '../utils/casino.js';
import { getOwnerNumbers } from '../utils/owner.js';

export const definition: ToolDefinition = {
    name: 'help',
    title: 'Command Help & Guide',
    category: 'System & Help',
    aliases: ['.help', '.menu', '.bantuan'],
    description:
        'Displays the bot navigation menu, category command lists, full command catalog, or detailed command guide.',
    descriptionKey: 'tools.commands.help.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The command name or category to view help for, or "all" for the full catalog'
            }
        },
        required: []
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | undefined> {
    const t = ctx?.t || getTranslator('en');
    const toolsHandler = (await import('./handler.js')).default;
    await toolsHandler.loadTools();

    const textMessage = ctx?.msg?.message?.conversation || ctx?.msg?.message?.extendedTextMessage?.text || '';
    const words = textMessage.trim().split(/\s+/);
    const firstWord = words[0]?.toLowerCase() || '';

    let rawQuery =
        typeof args.query === 'string'
            ? args.query.trim()
            : typeof args.category === 'string'
              ? args.category.trim()
              : typeof args.command === 'string'
                ? args.command.trim()
                : '';

    if (!rawQuery && words.length > 1) {
        rawQuery = words.slice(1).join(' ').trim();
    }

    if (firstWord === '.allmenu' && !rawQuery) {
        rawQuery = 'all';
    }

    // Determine bot owner identity
    const ownerNumbers = getOwnerNumbers();
    const senderRaw = cleanId(ctx?.msg?.key?.participant || ctx?.msg?.key?.remoteJid);
    const isOwner = Boolean(ctx?.msg?.key?.fromMe) || ownerNumbers.includes(senderRaw);

    // Calculate response speed/latency
    const msgTimestamp = ctx?.msg?.messageTimestamp ? Number(ctx.msg.messageTimestamp) * 1000 : 0;
    const speedMs = msgTimestamp > 0 ? Math.max(1, Date.now() - msgTimestamp) : 42;

    const pushName = ctx?.msg?.pushName || 'User';
    const lang = (ctx as any)?.lang || 'id';

    const dashboardHeader = formatDashboardHeader(
        {
            pushName,
            isOwner,
            speedMs,
            uptimeSeconds: process.uptime(),
            lang,
            prefix: '.',
            totalCommands: menuService.getCatalogStats().totalCommands
        },
        t
    );

    let outputText: string;

    if (!rawQuery) {
        // No argument: Show Category Overview with Dashboard Header
        outputText = `${dashboardHeader}\n\n${formatCategoryOverview(menuService.getCategoryList(), t, '.')}`;
    } else if (rawQuery.toLowerCase() === 'all') {
        // "all": Full command catalog
        outputText = `${dashboardHeader}\n\n${formatAllCommands(menuService.getCategoryList(), t, '.')}`;
    } else {
        // Lookup either command or category
        const foundCommand = menuService.findCommand(rawQuery);
        if (foundCommand) {
            outputText = formatCommandDetail(foundCommand, t, '.');
        } else {
            const foundCategory = menuService.findCategory(rawQuery);
            if (foundCategory) {
                outputText = formatCategoryCommands(foundCategory, t, '.');
            } else {
                outputText = formatNotFound('command', rawQuery, menuService.getCategoryList(), t, '.');
            }
        }
    }

    // Send via Baileys with larger hero banner if socket is available
    if (ctx?.sock && typeof ctx.sock.sendMessage === 'function') {
        const bannerBuffer = getMenuBannerBuffer();
        const matches = outputText.match(/@(\d+)/g);
        const mentions = matches ? formatMentions(matches.map((m) => m.substring(1))) : [];

        try {
            await ctx.sock.sendMessage(
                ctx.jid,
                {
                    text: outputText,
                    contextInfo: {
                        externalAdReply: {
                            title: t('tools.menu.banner_title'),
                            body: t('tools.menu.banner_body'),
                            mediaType: 1, // IMAGE
                            thumbnail: bannerBuffer,
                            renderLargerThumbnail: true, // Baileys hero banner attribute
                            sourceUrl: 'https://github.com/razaelmahasaputra/cosmos'
                        },
                        mentionedJid: mentions
                    }
                },
                { quoted: ctx.msg }
            );
        } catch (error) {
            console.error('[HelpTool] Failed to send menu with externalAdReply, falling back to plain text:', error);
            await ctx.sock.sendMessage(
                ctx.jid,
                {
                    text: outputText,
                    contextInfo: {
                        mentionedJid: mentions
                    }
                },
                { quoted: ctx.msg }
            );
        }
        return undefined; // Prevents message handler echo
    }

    return outputText;
}
