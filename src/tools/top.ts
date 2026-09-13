import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';

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
                    // Match by JID or LID
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
                    // Filter out users who have never played
                    if (isRoulette) {
                        if (rouletteRounds === 0 && rouletteWins === 0) continue;
                    } else {
                        // 10000 is the starter pack. Filter if they haven't played and balance is untouched.
                        if (gamesPlayed === 0 && balance === 10000n) continue;
                    }

                    participantStats.push({
                        mentionId: p.id, // e.g. "628...@s.whatsapp.net" or "1203...@lid"
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

            let text = isRoulette
                ? `${ctx.t('tools.top.roulette_title')}\n\n`
                : `${ctx.t('tools.top.casino_title')}\n\n`;
            const mentions: string[] = [];

            if (finalTopUsers.length === 0) {
                text += ctx.t('tools.top.empty');
            } else {
                finalTopUsers.forEach((user: any, index: number) => {
                    mentions.push(user.mentionId);
                    const displayName = user.pushName ? ` (${user.pushName})` : '';

                    if (isRoulette) {
                        text +=
                            ctx.t('tools.top.roulette_entry', {
                                icon: index === 0 ? '👑' : '💀',
                                rank: index + 1,
                                user: user.cleanId,
                                wins: user.rouletteWins,
                                matches: user.rouletteRounds
                            }) + '\n';
                    } else {
                        text +=
                            ctx.t('tools.top.casino_entry', {
                                icon: index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🎗️',
                                rank: index + 1,
                                user: user.cleanId,
                                name: displayName,
                                balance: formatRupiah(user.balance)
                            }) + '\n';
                    }
                });
            }

            await new Promise((resolve) => setTimeout(resolve, 3000));
            await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
        } catch (error) {
            console.error('[Top Command Error]', error);
            return ctx.t('tools.top.failed');
        }
    }
};

export default topTool;
