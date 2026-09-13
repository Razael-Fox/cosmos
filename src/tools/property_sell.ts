import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { formatRupiah, parseCurrencyAmount } from '../utils/currency.js';
import { getSenderJid } from '../utils/casino.js';
import { Groq } from 'groq-sdk';

function getGroqClient(): Groq {
    return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const propertySellTool: ToolModule = {
    definition: {
        name: 'sell',
        aliases: ['pawn', 'sellproperty'],
        description: 'Sell or pawn a property you own to the bank, with an optional AI negotiation system.',
        descriptionKey: 'tools.commands.sell.description',
        category: 'Economy',
        parameters: {
            type: 'object',
            properties: {
                property_name: {
                    type: 'string',
                    description: 'The name of the property to sell.'
                },
                negotiation: {
                    type: 'string',
                    description: 'Optional persuasion text to negotiate a better deal with the AI broker.'
                }
            },
            required: ['property_name']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const userJid = getSenderJid(msg, sock);
        if (!userJid) return;

        let propertyName = args.property_name;
        let negotiationText = args.negotiation;

        if (!propertyName) {
            await sock.sendMessage(
                jid,
                {
                    text: ctx.t('tools.property_sell.specify_property')
                },
                { quoted: msg }
            );
            return;
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [{ id: userJid }, { lid: userJid }]
            }
        });

        const actualUserId = user ? user.id : userJid;

        const allItems = (
            await prisma.userInventory.findMany({
                where: {
                    userId: actualUserId,
                    ownershipStatus: 'Owned',
                    propertyId: { not: null }
                },
                orderBy: [{ purchaseDate: 'asc' }, { id: 'asc' }]
            })
        ).filter(
            (item): item is typeof item & { propertyId: string; name: string; originalPrice: bigint } =>
                item.propertyId !== null && item.name !== null && item.originalPrice !== null
        );

        const fullInventory = (
            await prisma.userInventory.findMany({
                where: {
                    userId: actualUserId,
                    propertyId: { not: null }
                },
                orderBy: [{ purchaseDate: 'asc' }, { id: 'asc' }]
            })
        ).filter(
            (item): item is typeof item & { propertyId: string; name: string; originalPrice: bigint } =>
                item.propertyId !== null && item.name !== null && item.originalPrice !== null
        );

        let inventoryItem: (typeof allItems)[number] | null = null;

        if (propertyName && typeof propertyName === 'string') {
            const firstPart = propertyName.trim().split(' ')[0];
            const possibleId = parseInt(firstPart, 10);

            if (
                !isNaN(possibleId) &&
                possibleId.toString() === firstPart &&
                possibleId > 0 &&
                possibleId <= fullInventory.length
            ) {
                const mappedItem = fullInventory[possibleId - 1];
                if (mappedItem && mappedItem.ownershipStatus === 'Owned') {
                    inventoryItem = mappedItem;

                    if (!negotiationText && propertyName.trim().length > firstPart.length) {
                        negotiationText = propertyName.trim().substring(firstPart.length).trim();
                    }
                    propertyName = inventoryItem.name;
                }
            }
        }

        if (!inventoryItem && propertyName && typeof propertyName === 'string' && !negotiationText) {
            propertyName = propertyName.trim();
            const sortedItems = [...allItems].sort((a, b) => b.name.length - a.name.length);

            for (const item of sortedItems) {
                if (propertyName.toLowerCase().startsWith(item.name.toLowerCase())) {
                    inventoryItem = item;
                    const remaining = propertyName.slice(item.name.length).trim();
                    if (remaining.length > 0) {
                        negotiationText = remaining;
                    }
                    propertyName = item.name;
                    break;
                }
            }

            if (!inventoryItem) {
                const firstSpace = propertyName.indexOf(' ');
                if (firstSpace !== -1) {
                    negotiationText = propertyName.slice(firstSpace + 1).trim();
                    propertyName = propertyName.slice(0, firstSpace).trim();
                }
            }
        }

        if (!inventoryItem && propertyName) {
            inventoryItem = allItems.find((p) => p.name.toLowerCase() === propertyName.toLowerCase()) || null;
        }

        if (!inventoryItem) {
            await sock.sendMessage(
                jid,
                { text: ctx.t('tools.property_sell.not_owned', { name: propertyName }) },
                { quoted: msg }
            );
            return;
        }

        const propertyDef = await prisma.propertyCatalog.findUnique({
            where: { id: inventoryItem.propertyId }
        });

        if (!propertyDef) {
            await sock.sendMessage(
                jid,
                { text: ctx.t('tools.property_sell.definition_not_found', { name: propertyName }) },
                { quoted: msg }
            );
            return;
        }

        // Calculate Base Offer
        const originalPrice = Number(inventoryItem.originalPrice);
        const baseOffer = Math.floor(originalPrice * (1 - propertyDef.baseDepreciationRate));
        const hardCap = Math.floor(originalPrice * 0.99);

        let finalDealPrice = baseOffer;
        let aiLog = '';
        let aiMessage = '';

        if (negotiationText) {
            const parsedAmount = parseCurrencyAmount(negotiationText);
            if (parsedAmount) {
                negotiationText = `I want to sell this for ${formatRupiah(parsedAmount)}.`;
            } else {
                const words = negotiationText.split(' ');
                for (let i = 0; i < words.length; i++) {
                    const match = words[i].match(/^([^\w]*)(.*?)([^\w]*)$/);
                    if (match) {
                        const pre = match[1];
                        const core = match[2];
                        const post = match[3];
                        const val = parseCurrencyAmount(core);
                        if (val) {
                            words[i] = `${pre}${formatRupiah(val)}${post}`;
                        } else {
                            const valFull = parseCurrencyAmount(words[i]);
                            if (valFull) words[i] = formatRupiah(valFull);
                        }
                    } else {
                        const val = parseCurrencyAmount(words[i]);
                        if (val) words[i] = formatRupiah(val);
                    }
                }
                negotiationText = words.join(' ');
            }

            try {
                const groq = getGroqClient();
                const systemPrompt = `You are a pawn shop broker for Cosmos Casino. A user wants to sell their ${propertyName}.
The original price was ${originalPrice}. The standard base offer is ${baseOffer}. The maximum you can ever offer is ${hardCap}.
The user will try to negotiate a better deal. Evaluate their persuasion tactics. 
You can concede slightly if their argument is good, but you must NEVER exceed ${hardCap}.
You must call the 'finalize_deal' function to return your response.`;

                const completion = await groq.chat.completions.create({
                    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: negotiationText }
                    ],
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'finalize_deal',
                                description: 'Finalize the deal price and provide a message to the user.',
                                parameters: {
                                    type: 'object',
                                    properties: {
                                        deal_price: {
                                            type: 'integer',
                                            description: 'The final agreed price in Rupiah.'
                                        },
                                        broker_message: {
                                            type: 'string',
                                            description:
                                                'Your response to the user in formal English explaining why you accept or reject their terms.'
                                        }
                                    },
                                    required: ['deal_price', 'broker_message']
                                }
                            }
                        }
                    ],
                    tool_choice: { type: 'function', function: { name: 'finalize_deal' } },
                    temperature: 0.1
                });

                const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
                if (toolCall && toolCall.function.name === 'finalize_deal') {
                    const parsed = JSON.parse(toolCall.function.arguments);
                    finalDealPrice = parseInt(parsed.deal_price);
                    aiMessage = parsed.broker_message;
                    aiLog = toolCall.function.arguments;

                    // Enforce Hard Cap explicitly in code
                    if (finalDealPrice > hardCap) {
                        finalDealPrice = hardCap;
                    }
                    if (finalDealPrice < baseOffer * 0.5) {
                        // Sanity check lowballing
                        finalDealPrice = baseOffer;
                    }
                } else {
                    throw new Error('Groq did not return the expected tool call.');
                }
            } catch (err) {
                console.error('Groq negotiation failed:', err);
                aiMessage = ctx.t('tools.property_sell.negotiation_failed_fallback');
            }
        }

        // Process transaction
        await prisma.$transaction(async (tx) => {
            // Add funds to user
            await tx.user.update({
                where: { id: actualUserId },
                data: { balance: { increment: BigInt(finalDealPrice) } }
            });

            // Update inventory status
            await tx.userInventory.update({
                where: { id: inventoryItem.id },
                data: { ownershipStatus: 'Sold' }
            });

            // Log transaction
            await tx.propertyTransaction.create({
                data: {
                    userId: actualUserId,
                    propertyId: inventoryItem.propertyId,
                    transactionType: 'Sell',
                    amount: BigInt(finalDealPrice),
                    aiNegotiationLog: aiLog || null
                }
            });
        });

        let responseText = ctx.t('tools.property_sell.sold_title');
        responseText += ctx.t('tools.property_sell.sold_name', { name: inventoryItem.name });
        responseText += ctx.t('tools.property_sell.original_price', { price: formatRupiah(originalPrice) });
        responseText += ctx.t('tools.property_sell.base_offer', { price: formatRupiah(baseOffer) });

        if (negotiationText) {
            responseText += ctx.t('tools.property_sell.negotiated_price', { price: formatRupiah(finalDealPrice) });
            responseText += ctx.t('tools.property_sell.broker_says', { message: aiMessage });
        } else {
            responseText += ctx.t('tools.property_sell.final_price', { price: formatRupiah(finalDealPrice) });
            responseText += ctx.t('tools.property_sell.negotiate_hint', { name: propertyName });
        }

        await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
    }
};

export default propertySellTool;
