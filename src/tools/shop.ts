import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { getShopItems } from '../services/shopService.js';
import { renderCard, renderCatalogCard, renderAlert } from '../utils/uiFormatter.js';

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

            const propertiesLabel = ctx.t('tools.shop.category_properties');
            const categoryList = [propertiesLabel];
            for (const t of distinctItemTypes) {
                // Capitalize first letter
                const formatted = t.type.charAt(0).toUpperCase() + t.type.slice(1);
                if (!categoryList.includes(formatted)) {
                    categoryList.push(formatted);
                }
            }

            const text = renderCard({
                title: ctx.t('tools.shop.directory_title'),
                icon: '🏬',
                headerStyle: 'light',
                t: ctx.t,
                sections: [
                    {
                        title: ctx.t('tools.shop.available_categories'),
                        items: categoryList.map((cat) => ({
                            label: cat,
                            value: `.shop ${cat.toLowerCase()}`
                        }))
                    }
                ],
                tip: ctx.t('tools.shop.categories_usage')
            });

            await sock.sendMessage(jid, { text }, { quoted: msg });
            return;
        }

        // Check if user requested "properties" or "property"
        if (category === 'properties' || category === 'property') {
            const properties = await prisma.propertyCatalog.findMany({
                orderBy: [{ basePrice: 'asc' }, { name: 'asc' }]
            });

            if (properties.length === 0) {
                await sock.sendMessage(
                    jid,
                    {
                        text: renderAlert({
                            type: 'info',
                            title: ctx.t('tools.shop.property_catalog_alert_title'),
                            message: ctx.t('tools.shop.properties_empty'),
                            t: ctx.t
                        })
                    },
                    { quoted: msg }
                );
                return;
            }

            const text = renderCatalogCard(
                ctx.t('tools.shop.property_catalog_card_title'),
                '🏬',
                properties.map((p) => ({
                    title: p.name,
                    subtitle: ctx.t('tools.shop.property_subtitle', {
                        type: p.typeCategory,
                        depreciation: p.baseDepreciationRate * 100
                    }),
                    value: formatRupiah(Number(p.basePrice)),
                    badge: ctx.t('tools.shop.property_badge')
                })),
                ctx.t('tools.shop.properties_buy_tip'),
                ctx.t
            );
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
                    text: renderAlert({
                        type: 'warning',
                        title: ctx.t('tools.shop.no_items_found_alert'),
                        message: ctx.t('tools.shop.no_items', { category: rawCategory }),
                        t: ctx.t
                    })
                },
                { quoted: msg }
            );
            return;
        }

        const headerTitle = filterCategory
            ? ctx.t('tools.shop.items_suffix', {
                  category: filterCategory.charAt(0).toUpperCase() + filterCategory.slice(1)
              })
            : ctx.t('tools.shop.all_items_title');

        const text = renderCatalogCard(
            ctx.t('tools.shop.shop_header', { title: headerTitle.toUpperCase() }),
            '🛍️',
            items.map((item) => ({
                title: `${item.name} (${item.shortId})`,
                subtitle: item.description,
                value: formatRupiah(item.price),
                badge: item.type.toUpperCase()
            })),
            ctx.t('tools.shop.buy_tip'),
            ctx.t
        );

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default shopTool;
