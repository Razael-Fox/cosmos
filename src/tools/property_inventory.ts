import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { getSenderJid, buildUserOrConditions } from '../utils/casino.js';
import { renderCard, renderAlert, CardSection } from '../utils/uiFormatter.js';

const inventoryTool: ToolModule = {
    definition: {
        name: 'inventory',
        aliases: ['myitems', 'bag', 'inv'],
        description: 'View your currently owned items, equipment, and properties.',
        descriptionKey: 'tools.commands.inventory.description',
        category: 'Economy'
    },
    execute: async (_args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const userJid = getSenderJid(msg, sock);
        if (!userJid) return;

        const user = await prisma.user.findFirst({
            where: {
                OR: buildUserOrConditions(userJid)
            }
        });

        const actualUserId = user ? user.id : userJid;

        const inventory = await prisma.userInventory.findMany({
            where: {
                userId: actualUserId,
                ownershipStatus: 'Owned'
            },
            include: {
                item: true,
                property: true
            },
            orderBy: [{ purchaseDate: 'asc' }, { id: 'asc' }]
        });

        if (inventory.length === 0) {
            await sock.sendMessage(
                jid,
                {
                    text: renderAlert({
                        type: 'info',
                        title: 'INVENTORY VAULT',
                        message: ctx.t('tools.inventory.empty')
                    })
                },
                { quoted: msg }
            );
            return;
        }

        // Separate items and properties for organized display
        const shopItems = inventory.filter((inv) => inv.itemId !== null || inv.item !== null);
        const properties = inventory.filter((inv) => inv.propertyId !== null || inv.property !== null);
        // Any legacy items that might not have item/property relations
        const legacyItems = inventory.filter(
            (inv) => inv.itemId === null && inv.item === null && inv.propertyId === null && inv.property === null
        );

        const sections: CardSection[] = [];

        if (shopItems.length > 0) {
            sections.push({
                title: ctx.t('tools.inventory.section_items'),
                items: shopItems.map((inv) => {
                    const itemName = inv.item?.name || inv.name || ctx.t('tools.inventory.unknown_item');
                    const shortId = inv.item?.shortId ? ` (${inv.item.shortId})` : '';
                    const type = inv.item?.type || inv.typeCategory || 'Item';
                    const typeFormatted = type.charAt(0).toUpperCase() + type.slice(1);
                    return {
                        label: `${itemName}${shortId}`,
                        value: `x${inv.quantity} [${typeFormatted}]`
                    };
                })
            });
        }

        if (properties.length > 0) {
            sections.push({
                title: ctx.t('tools.inventory.section_properties'),
                items: properties.map((inv) => {
                    const propName = inv.property?.name || inv.name || ctx.t('tools.inventory.unknown_property');
                    const originalPrice = inv.originalPrice
                        ? formatRupiah(inv.originalPrice)
                        : ctx.t('tools.inventory.not_available');
                    return {
                        label: propName,
                        value: originalPrice
                    };
                })
            });
        }

        if (legacyItems.length > 0) {
            sections.push({
                title: ctx.t('tools.inventory.section_other'),
                items: legacyItems.map((inv) => ({
                    label: inv.name || ctx.t('tools.inventory.unknown_asset'),
                    value: `x${inv.quantity}`
                }))
            });
        }

        const text = renderCard({
            title: ctx.t('tools.inventory.vault_title'),
            icon: '📦',
            headerStyle: 'light',
            t: ctx.t,
            sections,
            tip: ctx.t('tools.inventory.footer_tip')
        });

        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default inventoryTool;
