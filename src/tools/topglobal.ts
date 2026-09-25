import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { formatMentions } from '../utils/casino.js';
import { renderCard, renderCatalogCard, CatalogItem } from '../utils/uiFormatter.js';

let topGlobalCache: any = null;
let topGlobalCacheExpiry: number = 0;
let topRouletteCache: any = null;
let topRouletteCacheExpiry: number = 0;

const topGlobalTool: ToolModule = {
    definition: {
        name: 'topglobal',
        title: 'Top Global Leaderboard',
        displayNames: { en: 'top global', id: 'top global' },
        aliases: ['.top global', 'top global', '.topglobal', 'topglobal', 'toplb'],
        description: 'View the global casino or roulette leaderboard.',
        descriptionKey: 'tools.commands.topglobal.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Category (optional, e.g. roulette)' }
            }
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const category = String(args.input || '')
            .trim()
            .toLowerCase();
        const isRoulette = category === 'roulette' || category === 'buckshot';

        const now = Date.now();
        const cache = isRoulette ? topRouletteCache : topGlobalCache;
        const expiry = isRoulette ? topRouletteCacheExpiry : topGlobalCacheExpiry;

        if (!cache || now > expiry) {
            const allUsers = await prisma.user.findMany();

            const userMap = new Map<string, any>();

            for (const user of allUsers) {
                if (isRoulette) {
                    if (user.rouletteRounds === 0 && user.rouletteWins === 0) continue;
                } else {
                    if (user.gamesPlayed === 0 && Number(user.balance) === 10000) continue;
                }
                userMap.set(user.id, { ...user });
            }

            for (const user of userMap.values()) {
                if (user.lid && userMap.has(user.lid)) {
                    const strayLid = userMap.get(user.lid);
                    user.balance = Number(user.balance) + Number(strayLid.balance);
                    user.rouletteWins += strayLid.rouletteWins;
                    user.rouletteRounds += strayLid.rouletteRounds;
                    if (strayLid.pushName && !user.pushName) user.pushName = strayLid.pushName;

                    userMap.delete(user.lid);
                }
            }

            const mergedUsers = Array.from(userMap.values());
            mergedUsers.sort((a, b) =>
                isRoulette ? b.rouletteWins - a.rouletteWins : Number(b.balance) - Number(a.balance)
            );

            if (isRoulette) {
                topRouletteCache = mergedUsers.slice(0, 10);
                topRouletteCacheExpiry = now + 5 * 60 * 1000;
            } else {
                topGlobalCache = mergedUsers.slice(0, 10);
                topGlobalCacheExpiry = now + 5 * 60 * 1000;
            }
        }

        const topUsersList = isRoulette ? topRouletteCache : topGlobalCache;

        if (topUsersList.length === 0) {
            await sock.sendMessage(jid, { text: ctx.t('tools.topglobal.empty') }, { quoted: msg });
            return;
        }

        const headerCard = renderCard({
            title: isRoulette ? ctx.t('tools.topglobal.header_roulette') : ctx.t('tools.topglobal.header_casino'),
            icon: '🏆',
            headerStyle: 'heavy',
            t: ctx.t,
            fields: [
                {
                    icon: '📍',
                    label: ctx.t('tools.topglobal.scope_label'),
                    value: ctx.t('tools.topglobal.scope_value')
                },
                { icon: '👥', label: ctx.t('tools.topglobal.ranked_players_label'), value: `${topUsersList.length}` }
            ]
        });

        const mentions: string[] = [];
        const items: CatalogItem[] = topUsersList.map((user: any, index: number) => {
            const medals = ['🥇', '🥈', '🥉', '🎗️'];
            const medal = index < 3 ? medals[index] : medals[3];
            const cleanId = user.id.split('@')[0];
            mentions.push(...formatMentions(user.id));
            const namePart = user.pushName ? ` (${user.pushName})` : '';

            if (isRoulette) {
                return {
                    rank: `${medal} ${index + 1}`,
                    title: `@${cleanId}${namePart}`,
                    subtitle: ctx.t('tools.topglobal.wins_matches', {
                        wins: user.rouletteWins,
                        matches: user.rouletteRounds
                    })
                };
            } else {
                const netWorth = Number(user.balance);
                const tier =
                    netWorth >= 10000000
                        ? ctx.t('tools.topglobal.tier_diamond')
                        : netWorth >= 1000000
                          ? ctx.t('tools.topglobal.tier_gold')
                          : netWorth >= 100000
                            ? ctx.t('tools.topglobal.tier_silver')
                            : ctx.t('tools.topglobal.tier_bronze');
                return {
                    rank: `${medal} ${index + 1}`,
                    title: `@${cleanId}${namePart}`,
                    value: ctx.t('tools.topglobal.balance_label', { balance: formatRupiah(user.balance) }),
                    subtitle: ctx.t('tools.topglobal.tier_label', { tier })
                };
            }
        });

        const listCard = renderCatalogCard(
            isRoulette ? ctx.t('tools.topglobal.catalog_roulette') : ctx.t('tools.topglobal.catalog_casino'),
            '👑',
            items,
            ctx.t('tools.topglobal.tip_climb'),
            ctx.t
        );

        const text = `${headerCard}\n\n${listCard}`;

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
    }
};

export default topGlobalTool;
