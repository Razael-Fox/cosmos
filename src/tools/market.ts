import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';

const marketTool: ToolModule = {
    definition: {
        name: 'market',
        aliases: ['economy'],
        description: 'Check the current state of the global economy and inflation.',
        descriptionKey: 'tools.commands.market.description',
        category: 'Economy'
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;

        // Fetch latest multiplier
        const latestData = await prisma.economyMultiplier.findFirst({
            orderBy: { appliedAt: 'desc' }
        });

        // Fetch latest exchange rate
        const latestRate = await prisma.exchangeRateLog.findFirst({
            orderBy: { createdAt: 'desc' }
        });

        if (!latestData || !latestRate) {
            await sock.sendMessage(jid, { text: ctx.t('tools.market.unavailable') }, { quoted: msg });
            return;
        }

        const text =
            `${ctx.t('tools.market.status_title')}\n\n` +
            `${ctx.t('tools.market.multiplier', { multiplier: latestData.multiplier })}\n` +
            `${ctx.t('tools.market.last_updated', { date: latestData.appliedAt.toLocaleString() })}\n` +
            `${ctx.t('tools.market.current_rate', { rate: formatRupiah(latestRate.rate) })}\n\n` +
            `${ctx.t('tools.market.tip')}`;

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default marketTool;
