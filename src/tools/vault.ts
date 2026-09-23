import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getHouseVault } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { renderCard } from '../utils/uiFormatter.js';

const vaultTool: ToolModule = {
    definition: {
        name: 'vault',
        aliases: ['bandar'],
        description: 'View the House Vault statistics.',
        descriptionKey: 'tools.commands.vault.description',
        category: 'Casino',
        owner: true,
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    execute: async (_args: Record<string, any>, ctx: ToolContext) => {
        const { sock, jid } = ctx;

        const vault = await getHouseVault(prisma);

        const fakeCosmosQuote = {
            key: {
                remoteJid: '0@s.whatsapp.net',
                fromMe: false,
                id: 'COSMOS_VAULT_MSG',
                participant: '0@s.whatsapp.net'
            },
            message: {
                conversation: ctx.t('tools.vault.quote')
            }
        };

        const text = renderCard({
            title: ctx.t('tools.vault.card_title'),
            icon: '🏛️',
            headerStyle: 'heavy',
            t: ctx.t,
            fields: [
                { icon: '📈', label: ctx.t('tools.vault.gross_income'), value: formatRupiah(vault.income) },
                { icon: '📉', label: ctx.t('tools.vault.payouts_issued'), value: formatRupiah(vault.payout) },
                { icon: '💎', label: ctx.t('tools.vault.profit_margin'), value: formatRupiah(vault.netProfit) }
            ],
            tips: [ctx.t('tools.vault.tip')]
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, { text }, { quoted: fakeCosmosQuote as any });
    }
};

export default vaultTool;
