import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { getShopItems } from '../services/shopService.js';

const shopTool: ToolModule = {
    definition: {
        name: 'shop',
        aliases: ['store', 'itemshop'],
        description: 'Browse the Cosmos Shop categories and available items.',
        descriptionKey: 'tools.commands.shop.description',
        category: 'Economy',
        parameters: {
            type: 'object',
            properties: {
                category: {
                    type: 'string',
                    description: 'The category to browse (e.g. items, properties, consumable, equipment, collectible).'
                }
            },
            required: []
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;

        // Parse category from args or raw command text if provided
        let rawCategory = args.category;
        if (!rawCategory) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const match = text.match(/^[./!#](?:shop|store|itemshop)\s+(.+)$/i);
            if (match) {
                rawCategory = match[1].trim();
            }
        }

        const category = typeof rawCategory === 'string' ? rawCategory.trim().toLowerCase() : '';

        // If no category specified, display the main categories menu
        if (!category) {
            // Find distinct item categories currently available
            const distinctItemTypes = await prisma.item.findMany({
                where: { isAvailable: true },
                select: { type: true },
                distinct: ['type']
            });

            const categoryList = ['Properties'];
            for (const t of distinctItemTypes) {
                // Capitalize first letter
                const formatted = t.type.charAt(0).toUpperCase() + t.type.slice(1);
                if (!categoryList.includes(formatted)) {
                    categoryList.push(formatted);
                }
            }

            let text = `${ctx.t('tools.shop.categories_title')}\n\n`;
            text += `${ctx.t('tools.shop.categories_select')}\n`;
            categoryList.forEach((cat) => {
                text += `• \`.shop ${cat.toLowerCase()}\`\n`;
            });
            text += `${ctx.t('tools.shop.categories_items_view')}\n\n`;
            text += `${ctx.t('tools.shop.categories_usage')}`;

            await sock.sendMessage(jid, { text }, { quoted: msg });
            return;
        }

        // Check if user requested "properties" or "property"
        if (category === 'properties' || category === 'property') {
            const properties = await prisma.propertyCatalog.findMany({
                orderBy: [{ basePrice: 'asc' }, { name: 'asc' }]
            });

            if (properties.length === 0) {
                await sock.sendMessage(jid, { text: ctx.t('tools.shop.properties_empty') }, { quoted: msg });
                return;
            }

            let text = `${ctx.t('tools.shop.properties_title')}\n\n`;
            properties.forEach((p, index) => {
                text += `${index + 1}. *${p.name}*\n`;
                text += `   Type: ${p.typeCategory}\n`;
                text += `   Price: ${formatRupiah(Number(p.basePrice))}\n`;
                text += `   Depreciation: ${p.baseDepreciationRate * 100}%\n\n`;
            });

            text += ctx.t('tools.shop.properties_buy_tip');
            await sock.sendMessage(jid, { text }, { quoted: msg });
            return;
        }

        // Otherwise, fetch shop items (either all items or filtered by category)
        const filterCategory = category === 'items' || category === 'all' ? undefined : category;
        const items = await getShopItems(filterCategory);

        if (items.length === 0) {
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.shop.no_items', { category: rawCategory })
                },
                { quoted: msg }
            );
            return;
        }

        const headerTitle = filterCategory
            ? `${filterCategory.charAt(0).toUpperCase() + filterCategory.slice(1)} Items`
            : 'All Items';

        let text = `${ctx.t('tools.shop.header_title', { title: headerTitle })}\n\n`;
        items.forEach((item, index) => {
            text += `${index + 1}. *${item.name}* (\`${item.shortId}\`)\n`;
            text += `   Type: ${item.type.charAt(0).toUpperCase() + item.type.slice(1)}\n`;
            text += `   Price: ${formatRupiah(item.price)}\n`;
            text += `   Desc: ${item.description}\n\n`;
        });

        text += ctx.t('tools.shop.buy_tip');

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default shopTool;
