import { PrismaClient } from '../generated/prisma/client.js';
import { prisma } from '../db.js';
import Chance from 'chance';
import { formatRupiah, parseCurrencyAmount } from './currency.js';

export { formatRupiah, formatNumberId, parseCurrencyAmount } from './currency.js';

export const chance = new Chance();

export async function autoMergeAccounts(oldId: string, newId: string) {
    if (oldId === newId) return;
    try {
        const oldUser = await prisma.user.findUnique({ where: { id: oldId } });
        if (!oldUser) return; // Nothing to merge

        const newUser = await prisma.user.findUnique({ where: { id: newId } });

        if (!newUser) {
            await prisma.user.update({ where: { id: oldId }, data: { id: newId } });
            console.log(`[AutoMerge] Renamed ${oldId} to ${newId}`);
            return;
        }

        await prisma.user.update({
            where: { id: newId },
            data: {
                lid: oldId,
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
        await prisma.user.delete({ where: { id: oldId } });
        console.log(`[AutoMerge] Merged stats from ${oldId} into ${newId}`);
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
    let user = await prisma.user.findFirst({
        where: { OR: [{ id: jidOrLid }, { lid: jidOrLid }] }
    });

    if (!user) {
        user = await prisma.user.create({
            data: { id: jidOrLid, pushName: pushName || null }
        });
    } else if (pushName && user.pushName !== pushName) {
        user = await prisma.user.update({
            where: { id: user.id },
            data: { pushName }
        });
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
    if (mutex.has(jid)) {
        return {
            success: false,
            error: t ? t('utilities.casino.processing') : 'Please wait, transaction is being processed.'
        };
    }
    mutex.add(jid);

    if (sock && msg) {
        await sock.sendMessage(msg.key.remoteJid, { react: { text: '🆗', key: msg.key } }).catch(() => {});
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const user = await tx.user.findFirst({ where: { OR: [{ id: jid }, { lid: jid }] } });
            if (!user) throw new Error(t ? t('utilities.casino.user_not_found') : 'User not found');

            if (Number(user.balance) < bet) {
                return {
                    success: false,
                    error: t
                        ? t('utilities.casino.insufficient_balance', { balance: formatRupiah(user.balance) })
                        : `Insufficient balance. Your balance: ${formatRupiah(user.balance)}`
                };
            }
            if (bet < MIN_BET) {
                return {
                    success: false,
                    error: t
                        ? t('utilities.casino.min_bet', { min: formatRupiah(MIN_BET) })
                        : `Minimum bet is ${formatRupiah(MIN_BET)}.`
                };
            }
            if (bet > MAX_BET) {
                return {
                    success: false,
                    error: t
                        ? t('utilities.casino.max_bet', { max: formatRupiah(MAX_BET) })
                        : `Maximum bet is ${formatRupiah(MAX_BET)}.`
                };
            }

            const now = Date.now();
            if (user.lastGambleAt) {
                const diff = now - user.lastGambleAt.getTime();
                if (diff < 5100) {
                    const remainingSeconds = ((5100 - diff) / 1000).toFixed(1);
                    return {
                        success: false,
                        error: t
                            ? t('utilities.casino.cooldown', { seconds: remainingSeconds })
                            : `Please wait ${remainingSeconds} more seconds before betting again.`
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

export const cleanId = (idStr: string | null | undefined): string => {
    if (!idStr) return '';
    return idStr.split(':')[0].split('@')[0];
};

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

export const lidToPnMap = new Map<string, string>();

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
    // always return the bot's own cleaned JID.
    if (msg.key.fromMe && sock?.user?.id) {
        return cleanId(sock.user.id);
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
                // Fire and forget auto-merge in background
                autoMergeAccounts(cleanedLid, cleanedAlt).catch(() => {});
            }
            jid = alt;
        } else if (lidToPnMap.has(cleanedLid)) {
            // Fallback to cache if WhatsApp didn't send participantAlt this time
            return lidToPnMap.get(cleanedLid)!;
        }
    }
    return cleanId(jid);
};
