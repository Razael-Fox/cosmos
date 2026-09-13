import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah } from '../utils/currency.js';
import { getSenderJid } from '../utils/casino.js';
import { purchaseItem } from '../services/shopService.js';

const buyTool: ToolModule = {
    definition: {
        name: 'buy',
        aliases: ['purchase'],
        description: 'Purchase an item or property from the shop using your balance.',
        descriptionKey: 'tools.commands.buy.description',
        category: 'Economy',
        parameters: {
            type: 'object',
            properties: {
                item_name: {
                    type: 'string',
                    description: 'The shortId or name of the item/property you want to buy.'
                },
                quantity: {
                    type: 'integer',
                    description: 'The quantity to purchase (defaults to 1).'
                }
            },
            required: ['item_name']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const userJid = getSenderJid(msg, sock);
        if (!userJid) return;

        // Ensure user exists in database
        let user = await prisma.user.findFirst({
            where: {
                OR: [{ id: userJid }, { lid: userJid }]
            }
        });
        if (!user) {
            user = await prisma.user.create({ data: { id: userJid, balance: BigInt(10000) } });
        }

        let inputTarget = args.item_name;
        let inputQuantity =
            args.quantity !== undefined && args.quantity !== null ? parseInt(String(args.quantity), 10) : undefined;

        if (!inputTarget) {
            // Attempt to parse from message text (e.g. .buy <short_id> [quantity])
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const match = text.match(/^[./!#](?:buy|purchase)\s+(.+)$/i);
            if (match) {
                const parts = match[1].trim().split(/\s+/);
                // Check if last part is a quantity number
                if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
                    inputQuantity = parseInt(parts.pop()!, 10);
                    inputTarget = parts.join(' ').trim();
                } else {
                    inputTarget = parts.join(' ').trim();
                }
            } else {
                await sock.sendMessage(
                    jid,
                    {
                        text: ctx.t('tools.property_buy.specify_item')
                    },
                    { quoted: msg }
                );
                return;
            }
        } else if (inputQuantity === undefined) {
            // If item_name was provided as a combined string like "gorengan 2" without explicit quantity parameter
            const parts = String(inputTarget).trim().split(/\s+/);
            if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
                inputQuantity = parseInt(parts.pop()!, 10);
                inputTarget = parts.join(' ').trim();
            } else {
                inputQuantity = 1;
            }
        }

        if (inputQuantity === undefined || isNaN(inputQuantity) || inputQuantity <= 0) {
            inputQuantity = 1;
        }

        const normalizedTarget = String(inputTarget).trim();

        // 1. First check if target matches an Item (by shortId or name)
        const matchedItem = await prisma.item.findFirst({
            where: {
                OR: [
                    { shortId: normalizedTarget.toLowerCase() },
                    { name: { equals: normalizedTarget } },
                    { id: normalizedTarget }
                ]
            }
        });

        if (matchedItem) {
            const purchaseResult = await purchaseItem(user.id, matchedItem.shortId, inputQuantity);

            if (!purchaseResult.success) {
                if (purchaseResult.message.includes('Insufficient balance')) {
                    const totalCost = matchedItem.price * BigInt(inputQuantity);
                    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
                    const currentBalance = freshUser ? freshUser.balance : user.balance;
                    await sock.sendMessage(
                        jid,
                        {
                            text: ctx.t('tools.property_buy.insufficient_item_funds', {
                                quantity: inputQuantity,
                                name: matchedItem.name,
                                cost: formatRupiah(totalCost),
                                balance: formatRupiah(currentBalance)
                            })
                        },
                        { quoted: msg }
                    );
                    return;
                }
                await sock.sendMessage(jid, { text: purchaseResult.message }, { quoted: msg });
                return;
            }

            const totalFormatted = formatRupiah(purchaseResult.totalCost || 0);
            const remainingFormatted = formatRupiah(purchaseResult.remainingBalance || 0);
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_buy.item_success', {
                        quantity: purchaseResult.quantity,
                        name: matchedItem.name,
                        cost: totalFormatted,
                        balance: remainingFormatted
                    })
                },
                { quoted: msg }
            );
            return;
        }

        // 2. If not found as Item, check if target matches a Property in PropertyCatalog
        const allProperties = await prisma.propertyCatalog.findMany({
            orderBy: [{ basePrice: 'asc' }, { name: 'asc' }]
        });

        let targetProp = null;
        const propertyIndex = parseInt(normalizedTarget, 10);
        if (
            /^\d+$/.test(normalizedTarget) &&
            !isNaN(propertyIndex) &&
            propertyIndex > 0 &&
            propertyIndex <= allProperties.length
        ) {
            targetProp = allProperties[propertyIndex - 1];
        }

        if (!targetProp) {
            targetProp = allProperties.find((p) => p.name.toLowerCase() === normalizedTarget.toLowerCase()) || null;
        }

        if (!targetProp) {
            targetProp =
                allProperties.find((p) => p.name.toLowerCase().includes(normalizedTarget.toLowerCase())) || null;
        }

        if (!targetProp) {
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_buy.not_found', { target: normalizedTarget })
                },
                { quoted: msg }
            );
            return;
        }

        // Check if user already owns this property
        const existingProperty = await prisma.userInventory.findFirst({
            where: {
                userId: user.id,
                propertyId: targetProp.id,
                ownershipStatus: 'Owned'
            }
        });

        if (existingProperty) {
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_buy.already_owned', { name: targetProp.name })
                },
                { quoted: msg }
            );
            return;
        }

        // Handle property purchase (properties are unique, quantity is 1)
        const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
        const userBalance = freshUser ? freshUser.balance : user.balance;

        if (userBalance < targetProp.basePrice) {
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_buy.insufficient_prop_funds', {
                        name: targetProp.name,
                        cost: formatRupiah(targetProp.basePrice),
                        balance: formatRupiah(userBalance)
                    })
                },
                { quoted: msg }
            );
            return;
        }

        try {
            await prisma.$transaction(async (tx) => {
                const currentUser = await tx.user.findUnique({
                    where: { id: user!.id }
                });

                if (!currentUser || currentUser.balance < targetProp!.basePrice) {
                    throw new Error('INSUFFICIENT_FUNDS');
                }

                await tx.user.update({
                    where: { id: user!.id },
                    data: { balance: { decrement: targetProp!.basePrice } }
                });

                await tx.userInventory.create({
                    data: {
                        userId: user!.id,
                        propertyId: targetProp!.id,
                        name: targetProp!.name,
                        typeCategory: targetProp!.typeCategory,
                        originalPrice: targetProp!.basePrice,
                        ownershipStatus: 'Owned'
                    }
                });

                await tx.propertyTransaction.create({
                    data: {
                        userId: user!.id,
                        propertyId: targetProp!.id,
                        transactionType: 'Buy',
                        amount: targetProp!.basePrice
                    }
                });

                await tx.activityLog.create({
                    data: {
                        userId: user!.id,
                        type: 'REAL_ESTATE_PURCHASE',
                        amount: targetProp!.basePrice,
                        description: `Purchased property ${targetProp!.name}`
                    }
                });
            });

            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_buy.prop_success', {
                        name: targetProp.name,
                        cost: formatRupiah(targetProp.basePrice)
                    })
                },
                { quoted: msg }
            );
        } catch (err: any) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                const latestUser = await prisma.user.findUnique({ where: { id: user.id } });
                const currentBal = latestUser ? latestUser.balance : BigInt(0);
                await sock.sendMessage(
                    jid,
                    {
                        text: ctx.t('tools.property_buy.insufficient_prop_funds', {
                            name: targetProp.name,
                            cost: formatRupiah(targetProp.basePrice),
                            balance: formatRupiah(currentBal)
                        })
                    },
                    { quoted: msg }
                );
                return;
            }
            console.error('Error during property purchase:', err);
            await sock.sendMessage(jid, { text: ctx.t('tools.property_buy.db_error') }, { quoted: msg });
        }
    }
};

export default buyTool;
