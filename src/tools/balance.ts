import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, resolveId, getUser, formatMentions } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';
import { renderCard } from '../utils/uiFormatter.js';

function getWealthTier(netWorth: number, t: (key: string, def?: string) => string): string {
    if (netWorth >= 100000000) return t('tools.ui.tier_sovereign', '👑 Sovereign Member');
    if (netWorth >= 10000000) return t('tools.ui.tier_diamond', '💎 Diamond Member');
    if (netWorth >= 1000000) return t('tools.ui.tier_gold', '🥇 Gold Member');
    if (netWorth >= 100000) return t('tools.ui.tier_silver', '🥈 Silver Member');
    return t('tools.ui.tier_bronze', '🥉 Bronze Member');
}

const balanceTool: ToolModule = {
    definition: {
        name: 'balance',
        aliases: ['bal', 'saldo'],
        description: "Check your current casino coin balance or another user's balance.",
        descriptionKey: 'tools.commands.balance.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    execute: async (_args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetJid = mentionedJidList.length > 0 ? mentionedJidList[0] : null;

        let queryJid = senderJid;
        let isCheckingOther = false;

        if (targetJid && targetJid !== senderJid) {
            const ownerNumber = process.env.BOT_PHONE_NUMBER ? process.env.BOT_PHONE_NUMBER.trim() : null;
            const senderRaw = senderJid ? senderJid.split(':')[0].split('@')[0] : null;
            const isOwner = Boolean(msg.key.fromMe) || (ownerNumber !== null && senderRaw === ownerNumber);

            if (!isOwner) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: t('tools.balance.owner_only_other') },
                    { quoted: msg }
                );
                return;
            }
            queryJid = await resolveId(targetJid, sock, msg.key.remoteJid);
            isCheckingOther = true;
        }

        const pushName = !isCheckingOther ? msg.pushName || undefined : undefined;
        const user = await getUser(prisma, queryJid, pushName);

        const userWithBank = await prisma.user.findUnique({
            where: { id: user.id },
            include: { bankAccount: true }
        });

        const walletBalance = Number(user.balance);
        const bankBalance = userWithBank?.bankAccount ? Number(userWithBank.bankAccount.balance) : 0;
        const netWorth = walletBalance + bankBalance;
        const bankAccStr = userWithBank?.bankAccount
            ? `${userWithBank.bankAccount.accountNumber} (${userWithBank.bankAccount.status})`
            : t('tools.ui.none_or_unregistered', 'Unregistered');

        let displayId = queryJid.split('@')[0];
        let mentionArray: string[] = formatMentions(queryJid);

        if (isCheckingOther && targetJid) {
            displayId = targetJid.split('@')[0];
            mentionArray = formatMentions(targetJid);
        }

        const text = renderCard({
            title: t('tools.balance.financial_balance', 'FINANCIAL BALANCE'),
            icon: '💰',
            headerStyle: 'heavy',
            fields: [
                { icon: '👤', label: t('tools.ui.account_label', 'Account'), value: `@${displayId}` },
                {
                    icon: '💵',
                    label: t('tools.ui.currency_wallet', 'Wallet Balance'),
                    value: formatRupiah(walletBalance)
                },
                { icon: '🏦', label: t('tools.ui.currency_bank', 'Bank Balance'), value: formatRupiah(bankBalance) },
                {
                    icon: '💎',
                    label: t('tools.ui.currency_networth', 'Total Net Worth'),
                    value: formatRupiah(netWorth)
                },
                {
                    icon: '🏅',
                    label: t('tools.ui.wealth_tier_label', 'Wealth Tier'),
                    value: getWealthTier(netWorth, t)
                },
                { icon: '💳', label: t('tools.ui.bank_account_label', 'Bank Account'), value: bankAccStr }
            ],
            tips: [
                t('tools.balance.tip_daily', 'Type .daily to claim free daily coins.'),
                t('tools.balance.tip_bank', 'Type .bank deposit <amount> to secure funds with 0.5% daily interest.')
            ]
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await sock.sendMessage(
            msg.key.remoteJid!,
            {
                text,
                mentions: mentionArray
            },
            { quoted: msg }
        );
    }
};

export default balanceTool;
