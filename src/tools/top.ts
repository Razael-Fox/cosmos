import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { formatMentions } from '../utils/casino.js';
import { renderCard, renderCatalogCard, CatalogItem } from '../utils/uiFormatter.js';

const topTool: ToolModule = {
    definition: {
        name: 'top',
        aliases: ['leaderboard', 'lb'],
        description: 'View the group casino leaderboard.',
        descriptionKey: 'tools.commands.top.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Category (e.g., roulette)' }
            }
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;

        if (!jid.endsWith('@g.us')) {
            return ctx.t('tools.top.group_only');
        }

        try {
            const groupMetadata = await sock.groupMetadata(jid);
            const memberJids: string[] = [];
            const idToJidMap = new Map<string, string>();
            const jidLidPairs: { jid: string; lid: string }[] = [];

            for (const p of groupMetadata.participants) {
                if (p.id) {
                    const cleaned = p.id.split(':')[0].split('@')[0];
                    const cleanedLid = (p as any).lid ? (p as any).lid.split(':')[0].split('@')[0] : null;

                    if (cleaned) {
                        memberJids.push(cleaned);
                        const domain = p.id.includes('@lid') ? 'lid' : 's.whatsapp.net';
                        idToJidMap.set(cleaned, `${cleaned}@${domain}`);
                    }

                    if (cleaned && cleanedLid && cleaned !== cleanedLid) {
                        jidLidPairs.push({ jid: cleaned, lid: cleanedLid });
                        idToJidMap.set(cleanedLid, `${cleanedLid}@lid`);

                        // Fire background merge so the database stays in sync with top's aggregation
                        import('../utils/casino.js').then(({ autoMergeAccounts }) => {
                            autoMergeAccounts(cleanedLid, cleaned).catch(() => {});
                        });
                    }
                }
            }
            const category = String(args.input || '')
                .trim()
                .toLowerCase();
            const isRoulette = category === 'roulette' || category === 'buckshot';

            // Gather all cleaned JIDs and LIDs from the group to query the DB
            const idsToFetch = new Set<string>();
            for (const p of groupMetadata.participants) {
                if (p.id) idsToFetch.add(p.id.split(':')[0].split('@')[0]);
                if ((p as any).lid) idsToFetch.add((p as any).lid.split(':')[0].split('@')[0]);
            }

            const idsArray = Array.from(idsToFetch);
            const allUsers: any[] = [];

            if (idsArray.length > 0) {
                const chunkSize = 500;
                const userMap = new Map<string, any>();
                for (let i = 0; i < idsArray.length; i += chunkSize) {
                    const chunk = idsArray.slice(i, i + chunkSize);
                    const usersChunk = await prisma.user.findMany({
                        where: { OR: [{ id: { in: chunk } }, { lid: { in: chunk } }] }
                    });
                    for (const u of usersChunk) {
                        userMap.set(u.id, u);
                    }
                }
                allUsers.push(...Array.from(userMap.values()));
            }

            // Map DB rows to actual participants to avoid duplicates and resolve mentions perfectly
            const participantStats: any[] = [];

            for (const p of groupMetadata.participants) {
                if (!p.id) continue;
                const pIdClean = p.id.split(':')[0].split('@')[0];
                const pLidClean = (p as any).lid ? (p as any).lid.split(':')[0].split('@')[0] : null;

                let balance = 0n;
                let rouletteWins = 0;
                let rouletteRounds = 0;
                let gamesPlayed = 0;
                let hasRecord = false;
                let pushName = '';

                for (const u of allUsers) {
                    if (
                        u.id === pIdClean ||
                        u.lid === pIdClean ||
                        (pLidClean && (u.id === pLidClean || u.lid === pLidClean))
                    ) {
                        hasRecord = true;
                        balance += BigInt(u.balance);
                        rouletteWins += u.rouletteWins;
                        rouletteRounds += u.rouletteRounds;
                        gamesPlayed += u.gamesPlayed;
                        if (u.pushName) pushName = u.pushName;
                    }
                }

                if (hasRecord) {
                    if (isRoulette) {
                        if (rouletteRounds === 0 && rouletteWins === 0) continue;
                    } else {
                        if (gamesPlayed === 0 && balance === 10000n) continue;
                    }

                    participantStats.push({
                        mentionId: p.id,
                        cleanId: pIdClean,
                        pushName,
                        balance,
                        rouletteWins,
                        rouletteRounds
                    });
                }
            }

            participantStats.sort((a, b) =>
                isRoulette ? b.rouletteWins - a.rouletteWins : Number(b.balance) - Number(a.balance)
            );

            const finalTopUsers = participantStats.slice(0, 10);

            if (finalTopUsers.length === 0) {
                await sock.sendMessage(jid, { text: ctx.t('tools.top.empty') }, { quoted: msg });
                return;
            }

            const headerCard = renderCard({
                title: isRoulette ? ctx.t('tools.top.header_roulette') : ctx.t('tools.top.header_casino'),
                icon: '🏆',
                headerStyle: 'heavy',
                t: ctx.t,
                fields: [
                    { icon: '📍', label: ctx.t('tools.top.scope_label'), value: ctx.t('tools.top.scope_value') },
                    { icon: '👥', label: ctx.t('tools.top.ranked_players_label'), value: `${finalTopUsers.length}` }
                ]
            });

            const mentions: string[] = [];
            const items: CatalogItem[] = finalTopUsers.map((user: any, index: number) => {
                const medals = ['🥇', '🥈', '🥉', '🎗️'];
                const medal = index < 3 ? medals[index] : medals[3];
                mentions.push(...formatMentions(user.mentionId));
                const namePart = user.pushName ? ` (${user.pushName})` : '';

                if (isRoulette) {
                    return {
                        rank: `${medal} ${index + 1}`,
                        title: `@${user.cleanId}${namePart}`,
                        subtitle: ctx.t('tools.top.wins_matches', {
                            wins: user.rouletteWins,
                            matches: user.rouletteRounds
                        })
                    };
                } else {
                    const netWorth = Number(user.balance);
                    const tier =
                        netWorth >= 10000000
                            ? ctx.t('tools.top.tier_diamond')
                            : netWorth >= 1000000
                              ? ctx.t('tools.top.tier_gold')
                              : netWorth >= 100000
                                ? ctx.t('tools.top.tier_silver')
                                : ctx.t('tools.top.tier_bronze');
                    return {
                        rank: `${medal} ${index + 1}`,
                        title: `@${user.cleanId}${namePart}`,
                        value: ctx.t('tools.top.balance_label', { balance: formatRupiah(user.balance) }),
                        subtitle: ctx.t('tools.top.tier_label', { tier })
                    };
                }
            });
            const listCard = renderCatalogCard(
                isRoulette ? ctx.t('tools.top.catalog_roulette') : ctx.t('tools.top.catalog_casino'),
                '👑',
                items,
                ctx.t('tools.top.tip_climb'),
                ctx.t
            );

            const text = `${headerCard}\n\n${listCard}`;

            await new Promise((resolve) => setTimeout(resolve, 1000));
            await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
        } catch (error) {
            console.error('[Top Command Error]', error);
            return ctx.t('tools.top.failed');
        }
    }
};

export default topTool;
