import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';

const propertyCatalogTool: ToolModule = {
    definition: {
        name: 'catalog',
        aliases: ['propertycatalog', 'properties'],
        description: 'View the property catalog to purchase real-world assets.',
        descriptionKey: 'tools.commands.catalog.description',
        category: 'Economy'
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;

        const properties = await prisma.propertyCatalog.findMany({
            orderBy: [{ basePrice: 'asc' }, { name: 'asc' }]
        });

        if (properties.length === 0) {
            await sock.sendMessage(jid, { text: ctx.t('tools.property_catalog.empty') }, { quoted: msg });
            return;
        }

        let text = `${ctx.t('tools.property_catalog.title')}\n\n`;
        properties.forEach((p, index) => {
            text += `${index + 1}. *${p.name}*\n`;
            text += `   Type: ${p.typeCategory}\n`;
            text += `   Price: ${formatRupiah(Number(p.basePrice))}\n`;
            text += `   Depreciation: ${p.baseDepreciationRate * 100}%\n\n`;
        });

        text += ctx.t('tools.property_catalog.buy_tip');

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default propertyCatalogTool;
