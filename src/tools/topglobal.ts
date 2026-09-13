import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';

let topGlobalCache: any = null;
let topGlobalCacheExpiry: number = 0;
let topRouletteCache: any = null;
let topRouletteCacheExpiry: number = 0;

const topGlobalTool: ToolModule = {
    definition: {
        name: 'topglobal',
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

            // First pass: Group by JID where possible.
            // If a row is clearly a LID (lid field is null, but we find another row with lid = this.id)
            // we will merge it.
            for (const user of allUsers) {
                if (isRoulette) {
                    if (user.rouletteRounds === 0 && user.rouletteWins === 0) continue;
                } else {
                    if (user.gamesPlayed === 0 && Number(user.balance) === 10000) continue;
                }

                // Determine the primary key: use user.lid if we somehow indexed by LID?
                // Actually, the simplest is to see if user.lid is populated.
                // If this user has a LID, another row might have id == user.lid.
                // We'll merge by whatever we can. Let's key by user.id, then in second pass merge LID rows into JID rows.
                userMap.set(user.id, { ...user });
            }

            // Second pass: Merge stray LID rows into their parent JID rows if both exist
            for (const user of userMap.values()) {
                if (user.lid && userMap.has(user.lid)) {
                    const strayLid = userMap.get(user.lid);
                    user.balance = Number(user.balance) + Number(strayLid.balance);
                    user.rouletteWins += strayLid.rouletteWins;
                    user.rouletteRounds += strayLid.rouletteRounds;
                    if (strayLid.pushName && !user.pushName) user.pushName = strayLid.pushName;

                    userMap.delete(user.lid); // Remove the stray LID row
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

        let groupMetadata: any = null;
        if (jid.endsWith('@g.us')) {
            try {
                groupMetadata = await sock.groupMetadata(jid);
            } catch {
                // ignore
            }
        }

        let text = isRoulette
            ? `${ctx.t('tools.topglobal.roulette_title')}\n\n`
            : `${ctx.t('tools.topglobal.casino_title')}\n\n`;
        const topUsersList = isRoulette ? topRouletteCache : topGlobalCache;
        const mentions: string[] = [];

        if (topUsersList.length === 0) {
            text += ctx.t('tools.topglobal.empty');
        } else {
            topUsersList.forEach((user: any, index: number) => {
                let domain: string;

                // If lid is populated in DB, we know id is JID.
                // Otherwise, try to find them in the current group for the exact domain.
                if (user.lid !== null) {
                    domain = 's.whatsapp.net';
                } else if (groupMetadata) {
                    const p = groupMetadata.participants.find(
                        (x: any) =>
                            (x.id && x.id.includes(user.id)) || ((x as any).lid && (x as any).lid.includes(user.id))
                    );
                    if (p) {
                        domain = p.id?.includes('@lid') ? 'lid' : 's.whatsapp.net';
                    } else {
                        domain = String(user.id).length >= 14 ? 'lid' : 's.whatsapp.net';
                    }
                } else {
                    domain = String(user.id).length >= 14 ? 'lid' : 's.whatsapp.net';
                }

                mentions.push(`${user.id}@${domain}`);

                const displayName = user.pushName ? ` (${user.pushName})` : '';

                if (isRoulette) {
                    text +=
                        ctx.t('tools.topglobal.roulette_entry', {
                            icon: index === 0 ? '👑' : '💀',
                            rank: index + 1,
                            user: user.id,
                            wins: user.rouletteWins,
                            matches: user.rouletteRounds
                        }) + '\n';
                } else {
                    text +=
                        ctx.t('tools.topglobal.casino_entry', {
                            icon: index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🎗️',
                            rank: index + 1,
                            user: user.id,
                            name: displayName,
                            balance: formatRupiah(user.balance)
                        }) + '\n';
                }
            });
        }

        text += `${ctx.t('tools.topglobal.footer')}`;

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
    }
};

export default topGlobalTool;
