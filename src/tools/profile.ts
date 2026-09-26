import { ToolDefinition, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser, formatMentions, cleanId } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { renderCard } from '../utils/uiFormatter.js';
import { isOwnerId } from '../utils/owner.js';
import { QuotaService } from '../services/quotaService.js';

export const definition: ToolDefinition = {
    name: 'profile',
    title: 'User Profile',
    displayNames: { en: 'my profile', id: 'profil saya' },
    category: 'Tools & Utilities',
    aliases: ['.my profile', 'my profile', '.profile', 'profile', '.myprofile', 'myprofile', 'my-profile'],
    description: 'View your complete Cosmos profile, identity, financial stats, and gaming records.',
    descriptionKey: 'tools.commands.profile.description',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Optional user mention' }
        },
        required: []
    }
};

function getCreditRating(score: number): string {
    if (score >= 750) return '⭐ Excellent';
    if (score >= 650) return '🟢 Good';
    if (score >= 550) return '🟡 Fair';
    return '🔴 High Risk';
}

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const { msg, sock, jid } = ctx;
    const senderJid = getSenderJid(msg, sock);

    const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const targetJid = mentionedJidList.length > 0 ? mentionedJidList[0] : null;

    let queryJid = senderJid;
    let isCheckingOther = false;
    if (targetJid && cleanId(targetJid) !== cleanId(senderJid)) {
        queryJid = targetJid;
        isCheckingOther = true;
    }

    const pushName = !isCheckingOther ? msg.pushName || undefined : undefined;
    await getUser(prisma, queryJid, pushName);

    const user = await prisma.user.findFirst({
        where: {
            OR: [{ id: queryJid }, { id: cleanId(queryJid) + '@s.whatsapp.net' }]
        },
        include: {
            idCard: true,
            bankAccount: true,
            currentJob: true,
            subscription: true,
            _count: {
                select: {
                    contacts: true,
                    inventories: true
                }
            }
        }
    });

    if (!user) {
        return ctx.t('tools.profile.not_found', 'User profile not found in database.');
    }

    const isOwner = isOwnerId(queryJid);
    const quota = await QuotaService.getUserQuota(queryJid, isOwner);

    const walletBalance = Number(user.balance);
    const bankBalance = user.bankAccount ? Number(user.bankAccount.balance) : 0;
    const netWorth = walletBalance + bankBalance;

    const gamesPlayed = user.gamesPlayed || 0;
    const totalWins = user.totalWins || 0;
    const winRate = gamesPlayed > 0 ? `${((totalWins / gamesPlayed) * 100).toFixed(1)}%` : '0.0%';

    const planLabel = isOwner
        ? 'Owner (Unlimited)'
        : quota.tier === 'PARTNER'
          ? 'Zenith (Partner)'
          : quota.tier === 'SUBSIDIZED'
            ? 'Nova (Subsidized)'
            : 'Pulse (Free)';

    const idCardStatus = user.idCard
        ? `✅ Verified (NIK: ${user.idCard.nik})`
        : '❌ Unregistered (.register id to apply)';

    const bankStatus = user.bankAccount
        ? `${user.bankAccount.accountNumber} (${user.bankAccount.status})`
        : 'Unregistered (.bank register to open)';

    const jobTitle = user.currentJob ? user.currentJob.name : 'Unemployed (.job list to browse)';
    const displayPhone = queryJid.split('@')[0];
    const displayName = user.pushName || displayPhone;

    const text = renderCard({
        title: ctx.t('tools.profile.title', 'COSMOS CITIZEN PROFILE'),
        icon: '👤',
        headerStyle: 'heavy',
        subtitle: `${displayName} • @${displayPhone}`,
        sections: [
            {
                title: ctx.t('tools.profile.section_identity', '📋 Identity & Citizenship'),
                items: [
                    { icon: '🆔', label: ctx.t('tools.profile.label_idcard', 'Virtual ID Card'), value: idCardStatus },
                    { icon: '⭐', label: ctx.t('tools.profile.label_membership', 'Membership Tier'), value: planLabel },
                    { icon: '💼', label: ctx.t('tools.profile.label_career', 'Career / Job'), value: jobTitle },
                    {
                        icon: '📊',
                        label: ctx.t('tools.profile.label_credit_score', 'Credit Score'),
                        value: `${user.creditScore}/1000 (${getCreditRating(user.creditScore)})`
                    }
                ]
            },
            {
                title: ctx.t('tools.profile.section_financial', '💰 Financial Overview'),
                items: [
                    {
                        icon: '💵',
                        label: ctx.t('tools.ui.currency_wallet', 'Wallet Balance'),
                        value: formatRupiah(walletBalance)
                    },
                    {
                        icon: '🏦',
                        label: ctx.t('tools.ui.currency_bank', 'Bank Balance'),
                        value: formatRupiah(bankBalance)
                    },
                    {
                        icon: '💎',
                        label: ctx.t('tools.ui.currency_networth', 'Total Net Worth'),
                        value: formatRupiah(netWorth)
                    },
                    { icon: '💳', label: ctx.t('tools.ui.bank_account_label', 'Bank Account'), value: bankStatus }
                ]
            },
            {
                title: ctx.t('tools.profile.section_stats', '🎮 Activity & Records'),
                items: [
                    {
                        icon: '🎲',
                        label: ctx.t('tools.profile.label_games', 'Casino Games'),
                        value: `${gamesPlayed} (${winRate} win rate)`
                    },
                    {
                        icon: '💥',
                        label: ctx.t('tools.profile.label_roulette', 'Buckshot Roulette'),
                        value: `${user.rouletteWins} wins / ${user.rouletteRounds} rounds`
                    },
                    {
                        icon: '🎒',
                        label: ctx.t('tools.profile.label_items', 'Inventory Items'),
                        value: `${user._count?.inventories ?? 0} owned`
                    },
                    {
                        icon: '📇',
                        label: ctx.t('tools.profile.label_contacts', 'Encrypted Contacts'),
                        value: `${user._count?.contacts ?? 0} saved`
                    }
                ]
            }
        ],
        tips: [
            ctx.t('tools.profile.tip_plan', 'Type .my plan or .check plan to view subscription tier perks.'),
            ctx.t('tools.profile.tip_quota', 'Type .my quota or .check quota to monitor resource limits.'),
            ctx.t('tools.profile.tip_contacts', 'Type .contact list or .contact backup to manage personal contacts.')
        ],
        t: ctx.t
    });

    const mentions = formatMentions([queryJid]);
    await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
}

export default { definition, execute };
