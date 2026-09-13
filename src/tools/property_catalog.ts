import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { renderCatalogCard, renderAlert } from '../utils/uiFormatter.js';

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
            await sock.sendMessage(
                jid,
                {
                    text: renderAlert({
                        type: 'info',
                        title: 'PROPERTY CATALOG',
                        message: ctx.t('tools.property_catalog.empty')
                    })
                },
                { quoted: msg }
            );
            return;
        }

        const text = renderCatalogCard(
            'COSMOS PROPERTY CATALOG',
            '🏬',
            properties.map((p) => ({
                title: p.name,
                subtitle: `Type: ${p.typeCategory} • Depreciation: ${p.baseDepreciationRate * 100}%`,
                value: formatRupiah(Number(p.basePrice)),
                badge: 'PROPERTY'
            })),
            ctx.t('tools.property_catalog.buy_tip')
        );

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default propertyCatalogTool;
