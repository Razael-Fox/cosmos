import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getHouseVault } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';

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
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
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

        const text =
            `${ctx.t('tools.vault.title')}\n\n` +
            `${ctx.t('tools.vault.income', { income: formatRupiah(vault.income) })}\n` +
            `${ctx.t('tools.vault.payout', { payout: formatRupiah(vault.payout) })}\n` +
            `${ctx.t('tools.vault.net_profit', { profit: formatRupiah(vault.netProfit) })}`;

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sock.sendMessage(jid, { text }, { quoted: fakeCosmosQuote as any });
    }
};

export default vaultTool;
