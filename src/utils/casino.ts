import { PrismaClient } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import Chance from 'chance';
import { formatRupiah, parseCurrencyAmount } from './currency.js';
import { getTranslator } from './i18n.js';

export { formatRupiah, formatNumberId, parseCurrencyAmount } from './currency.js';

export const chance = new Chance();

export const cleanId = (idStr: string | null | undefined): string => {
    if (!idStr) return '';
    return idStr.split(':')[0].split('@')[0];
};

export const lidToPnMap = new Map<string, string>();
export const pnToLidMap = new Map<string, string>();

export function buildUserOrConditions(jidOrLid: string): Array<{ id?: string; lid?: string }> {
    if (!jidOrLid) return [];
    const cleaned = cleanId(jidOrLid);
    const mappedPn = lidToPnMap.get(cleaned);
    const mappedLid = pnToLidMap.get(cleaned);

    const isLid =
        jidOrLid.includes('@lid') ||
        Boolean(mappedPn) ||
        (cleaned.length >= 13 && !jidOrLid.includes('@s.whatsapp.net') && !mappedLid);
    const canonicalJid = cleaned && !isLid ? `${cleaned}@s.whatsapp.net` : null;
    const mappedCanonicalJid = mappedPn ? `${mappedPn}@s.whatsapp.net` : null;

    const conditions: Array<{ id?: string; lid?: string }> = [{ id: jidOrLid }, { lid: jidOrLid }];

    if (cleaned) {
        conditions.push({ id: cleaned });
        conditions.push({ lid: cleaned });
    }
    if (canonicalJid) {
        conditions.push({ id: canonicalJid });
    }
    if (isLid && cleaned) {
        conditions.push({ lid: cleaned });
        conditions.push({ lid: `${cleaned}@lid` });
        conditions.push({ id: `${cleaned}@lid` });
    }
    if (mappedCanonicalJid) {
        conditions.push({ id: mappedCanonicalJid });
    }
    if (mappedPn) {
        conditions.push({ id: mappedPn });
        conditions.push({ id: `${mappedPn}@s.whatsapp.net` });
    }
    if (mappedLid) {
        conditions.push({ lid: mappedLid });
        conditions.push({ lid: `${mappedLid}@lid` });
        conditions.push({ id: `${mappedLid}@lid` });
    }

    return conditions;
}

export async function autoMergeAccounts(oldId: string, newId: string) {
    if (oldId === newId) return;
    try {
        const oldConditions = buildUserOrConditions(oldId);
        const newConditions = buildUserOrConditions(newId);

        const oldUser = await prisma.user.findFirst({ where: { OR: oldConditions } });
        if (!oldUser) return; // Nothing to merge

        const newUser = await prisma.user.findFirst({ where: { OR: newConditions } });

        if (!newUser) {
            const cleanNew = cleanId(newId);
            const canonicalNew = cleanNew.length <= 14 ? `${cleanNew}@s.whatsapp.net` : `${cleanNew}@lid`;
            await prisma.user.update({ where: { id: oldUser.id }, data: { id: canonicalNew } });
            console.log(`[AutoMerge] Renamed ${oldUser.id} to ${canonicalNew}`);
            return;
        }

        if (oldUser.id === newUser.id) {
            return;
        }

        const cleanOld = cleanId(oldId);
        await prisma.user.update({
            where: { id: newUser.id },
            data: {
                lid: cleanOld,
                balance: { increment: oldUser.balance },
                totalWins: { increment: oldUser.totalWins },
                totalLosses: { increment: oldUser.totalLosses },
                gamesPlayed: { increment: oldUser.gamesPlayed },
                rouletteRounds: { increment: oldUser.rouletteRounds },
                rouletteWins: { increment: oldUser.rouletteWins },
                rouletteKills: { increment: oldUser.rouletteKills },
                rouletteAfk: { increment: oldUser.rouletteAfk }
            }
        });
        await prisma.user.delete({ where: { id: oldUser.id } }).catch((err) => {
            console.warn(`[AutoMerge] Could not delete oldUser ${oldUser.id} after merge:`, err.message);
        });
        console.log(`[AutoMerge] Merged stats from ${oldUser.id} into ${newUser.id}`);
    } catch (error) {
        console.error(`[AutoMerge] Error merging ${oldId} -> ${newId}:`, error);
    }
}

// Fever Time in-memory state
export const casinoState = {
    feverTimeEnd: 0
};

export const isFeverTime = () => Date.now() < casinoState.feverTimeEnd;

export async function getHouseVault(prisma: PrismaClient) {
    let vault = await prisma.houseVault.findUnique({ where: { id: 1 } });
    if (!vault) {
        vault = await prisma.houseVault.create({ data: { id: 1 } });
    }
    return vault;
}

export async function getUser(prisma: PrismaClient, jidOrLid: string, pushName?: string) {
    if (!jidOrLid) throw new Error('Invalid user identifier');

    const conditions = buildUserOrConditions(jidOrLid);
    let user = await prisma.user.findFirst({
        where: { OR: conditions }
    });

    const cleaned = cleanId(jidOrLid);
    const mappedPn = lidToPnMap.get(cleaned);
    const mappedLid = pnToLidMap.get(cleaned);
    const isLid =
        jidOrLid.includes('@lid') ||
        Boolean(mappedPn) ||
        (cleaned.length >= 13 && !jidOrLid.includes('@s.whatsapp.net') && !mappedLid);

    const targetId = mappedPn
        ? `${mappedPn}@s.whatsapp.net`
        : !isLid && cleaned
          ? `${cleaned}@s.whatsapp.net`
          : jidOrLid;
    const targetLid = isLid ? cleaned : mappedLid || null;

    if (!user) {
        user = await prisma.user.create({
            data: {
                id: targetId,
                lid: targetLid,
                pushName: pushName || null,
                username: pushName || null
            }
        });
    } else {
        const updateData: { pushName?: string; lid?: string } = {};
        if (pushName && user.pushName !== pushName) {
            updateData.pushName = pushName;
        }
        if (targetLid && !user.lid) {
            updateData.lid = targetLid;
        }
        if (Object.keys(updateData).length > 0) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: updateData
            });
        }
    }
    return user;
}

export function parseBet(input: string, balance: number): number | null {
    return parseCurrencyAmount(input, balance);
}

const mutex = new Set<string>();

type GambleResult =
    { success: true; isWin: boolean; winAmount: number; newBalance: number } | { success: false; error: string };

export const MIN_BET = 18000;
export const MAX_BET = 1500000;

export async function executeGamble(
    prisma: PrismaClient,
    jid: string,
    bet: number,
    winMultiplier: number,
    baseWinWeight: number,
    baseLoseWeight: number,
    sock?: any,
    msg?: any,
    fixedBonus: number = 0,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<GambleResult> {
    const tr = t || getTranslator('id');
    if (mutex.has(jid)) {
        return {
            success: false,
            error: tr('utilities.casino.processing')
        };
    }
    mutex.add(jid);

    if (sock && msg) {
        await sock.sendMessage(msg.key.remoteJid, { react: { text: '🆗', key: msg.key } }).catch(() => {});
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const user = await tx.user.findFirst({ where: { OR: buildUserOrConditions(jid) } });
            if (!user) throw new Error(tr('utilities.casino.user_not_found'));

            if (Number(user.balance) < bet) {
                return {
                    success: false,
                    error: tr('utilities.casino.insufficient_balance', { balance: formatRupiah(user.balance) })
                };
            }
            if (bet < MIN_BET) {
                return {
                    success: false,
                    error: tr('utilities.casino.min_bet', { min: formatRupiah(MIN_BET) })
                };
            }
            if (bet > MAX_BET) {
                return {
                    success: false,
                    error: tr('utilities.casino.max_bet', { max: formatRupiah(MAX_BET) })
                };
            }

            const now = Date.now();
            if (user.lastGambleAt) {
                const diff = now - user.lastGambleAt.getTime();
                if (diff < 5100) {
                    const remainingSeconds = ((5100 - diff) / 1000).toFixed(1);
                    return {
                        success: false,
                        error: tr('utilities.casino.cooldown', { seconds: remainingSeconds })
                    };
                }
            }

            let vault = await tx.houseVault.findUnique({ where: { id: 1 } });
            if (!vault) {
                vault = await tx.houseVault.create({ data: { id: 1 } });
            }

            let winWeight = baseWinWeight;
            let loseWeight = baseLoseWeight;

            if (isFeverTime()) {
                // Fever Time: boosted win rate, bypass anti-win streak
                winWeight = 60;
                loseWeight = 40;
            } else {
                // Balanced anti-win streak: gentle penalty if player is far ahead
                if (user.totalWins > user.totalLosses + 15) {
                    winWeight = Math.max(5, winWeight - 5);
                }

                // Global RTP adjustment: soft moderation instead of forced instant lose
                const netProfit = Number(vault.netProfit);
                const potentialWin = bet * winMultiplier + fixedBonus;

                if (netProfit < -1000000 && (bet > 500000 || potentialWin > 500000)) {
                    winWeight = Math.max(5, winWeight - 10);
                }
                if (netProfit < -5000000 && (bet > 1000000 || potentialWin > 1000000)) {
                    winWeight = Math.max(1, winWeight - 15);
                }

                // Dynamic high-stakes scaling: gentle moderation for high-percentage bets
                if (bet >= Number(user.balance) * 0.9 && bet >= 1000000) {
                    winWeight = Math.max(5, Math.floor(winWeight * 0.8));
                }
            }

            const isWin = chance.weighted([true, false], [winWeight, loseWeight]);

            let winAmount = 0;
            const profitChange = isWin
                ? BigInt(-1) * BigInt(Math.floor(bet * winMultiplier) + fixedBonus - bet)
                : BigInt(bet);

            if (isWin) {
                winAmount = Math.floor(bet * winMultiplier) + fixedBonus;
            }

            const balanceChange = isWin ? winAmount - bet : -bet;

            const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: {
                    balance: { increment: balanceChange },
                    lastGambleAt: new Date(now),
                    gamesPlayed: { increment: 1 },
                    totalWins: isWin ? { increment: 1 } : undefined,
                    totalLosses: !isWin ? { increment: 1 } : undefined
                }
            });

            await tx.houseVault.update({
                where: { id: 1 },
                data: {
                    income: isWin ? undefined : { increment: BigInt(bet) },
                    payout: isWin ? { increment: BigInt(winAmount - bet) } : undefined,
                    netProfit: { increment: profitChange }
                }
            });

            // Log activity for credit rating
            await tx.activityLog.create({
                data: {
                    userId: user.id,
                    type: isWin ? 'CASINO_WIN' : 'CASINO_LOSS',
                    amount: isWin ? BigInt(winAmount) : BigInt(bet),
                    description: isWin
                        ? `Won ${formatRupiah(winAmount)} in casino.`
                        : `Lost ${formatRupiah(bet)} in casino.`
                }
            });

            return {
                success: true as const,
                isWin,
                winAmount,
                newBalance: Number(updatedUser.balance)
            };
        });
    } finally {
        mutex.delete(jid);
    }
}

export const formatMentions = (ids: string | string[]): string[] => {
    const idArray = Array.isArray(ids) ? ids : [ids];
    const mentions: string[] = [];
    for (const id of idArray) {
        if (!id) continue;
        const cleaned = cleanId(id);
        if (!cleaned) continue;
        const isLid = id.includes('@lid') || cleaned.length > 14;
        mentions.push(isLid ? `${cleaned}@lid` : `${cleaned}@s.whatsapp.net`);
    }
    return mentions;
};

export const resolveId = async (
    idStr: string | null | undefined,
    sock?: any,
    groupJid?: string | null | undefined
): Promise<string> => {
    const cleaned = cleanId(idStr);
    if (!cleaned) return '';
    const resolved = lidToPnMap.get(cleaned) || cleaned;

    const isLid = idStr?.includes('@lid') || cleaned.length > 14;

    if (resolved === cleaned && isLid && sock && groupJid?.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(groupJid);
            for (const p of groupMetadata.participants) {
                const pId = p.id ? cleanId(p.id) : null;
                const pLid = (p as any).lid ? cleanId((p as any).lid) : null;

                if (pLid === cleaned && pId && pId !== pLid) {
                    lidToPnMap.set(pLid, pId);
                    autoMergeAccounts(pLid, pId).catch(() => {});
                    return pId;
                }
            }
        } catch {
            // ignore
        }
    }
    return resolved;
};

export const getSenderJid = (msg: any, sock?: any): string => {
    // When the bot sends a command or message (fromMe in a DM or group),
    // always return the bot's own canonical JID.
    if (msg.key.fromMe && sock?.user?.id) {
        const botPhone = cleanId(sock.user.id);
        return botPhone ? `${botPhone}@s.whatsapp.net` : '';
    }

    let jid = msg.key.participant || msg.key.remoteJid;
    if (jid && jid.endsWith('@lid')) {
        const alt =
            msg.key.participantAlt ||
            msg.key.remoteJidAlt ||
            (msg.key as any).participantAlt ||
            (msg.key as any).remoteJidAlt;

        const cleanedLid = cleanId(jid);

        if (alt) {
            const cleanedAlt = cleanId(alt);
            if (!lidToPnMap.has(cleanedLid) || lidToPnMap.get(cleanedLid) !== cleanedAlt) {
                lidToPnMap.set(cleanedLid, cleanedAlt);
                pnToLidMap.set(cleanedAlt, cleanedLid);
                // Fire and forget auto-merge in background
                autoMergeAccounts(cleanedLid, cleanedAlt).catch(() => {});
            }
            jid = alt;
        } else if (lidToPnMap.has(cleanedLid)) {
            // Fallback to cache if WhatsApp didn't send participantAlt this time
            return `${lidToPnMap.get(cleanedLid)!}@s.whatsapp.net`;
        }
    }
    const cleaned = cleanId(jid);
    if (!cleaned) return '';
    const mappedPn = lidToPnMap.get(cleaned);
    if (mappedPn) {
        return `${mappedPn}@s.whatsapp.net`;
    }
    const isLid = jid?.endsWith('@lid') || (cleaned.length >= 13 && !jid?.includes('@s.whatsapp.net'));
    return isLid ? `${cleaned}@lid` : `${cleaned}@s.whatsapp.net`;
};
