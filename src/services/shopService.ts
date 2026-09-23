import { prisma } from '../db.js';
import { getUser } from '../utils/casino.js';

export type PurchaseErrorCode =
    'SUCCESS' | 'INSUFFICIENT_BALANCE' | 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_QUANTITY' | 'DATABASE_ERROR';

export interface PurchaseResult {
    success: boolean;
    code: PurchaseErrorCode;
    message: string;
    item?: {
        name: string;
        shortId: string;
        price: bigint;
        type: string;
    };
    quantity?: number;
    totalCost?: bigint;
    remainingBalance?: bigint;
}

/**
 * Fetch all available items from the database.
 */
export async function getShopItems(category?: string) {
    const where: any = { isAvailable: true };
    if (category) {
        where.type = category.toLowerCase();
    }
    return await prisma.item.findMany({
        where,
        orderBy: [{ price: 'asc' }, { name: 'asc' }]
    });
}

/**
 * Fetch distinct item types/categories available in the shop.
 */
export async function getShopCategories(): Promise<string[]> {
    const items = await prisma.item.findMany({
        where: { isAvailable: true },
        select: { type: true },
        distinct: ['type']
    });
    return items.map((i) => i.type);
}

/**
 * Purchase an item using user's balance.
 * Executes a Prisma $transaction to safely deduct balance and upsert into UserInventory.
 */
export async function purchaseItem(
    userId: string,
    itemIdOrShortId: string,
    quantity: number = 1
): Promise<PurchaseResult> {
    if (quantity <= 0 || !Number.isInteger(quantity)) {
        return {
            success: false,
            code: 'INVALID_QUANTITY',
            message: 'Invalid purchase quantity. Quantity must be a positive integer.'
        };
    }

    // Lookup item by shortId (case-insensitive) or by id
    const item = await prisma.item.findFirst({
        where: {
            OR: [{ shortId: itemIdOrShortId.toLowerCase() }, { id: itemIdOrShortId }]
        }
    });

    if (!item) {
        return {
            success: false,
            code: 'NOT_FOUND',
            message: `Item "${itemIdOrShortId}" was not found.`
        };
    }

    if (!item.isAvailable) {
        return {
            success: false,
            code: 'UNAVAILABLE',
            message: `*${item.name}* is currently unavailable in the shop.`
        };
    }

    // Ensure user exists
    const user = await getUser(prisma as any, userId);

    const actualUserId = user.id;
    const totalCost = item.price * BigInt(quantity);

    if (user.balance < totalCost) {
        return {
            success: false,
            code: 'INSUFFICIENT_BALANCE',
            message: `Insufficient balance to complete the purchase.`
        };
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Re-fetch user in transaction with balance check to prevent race conditions
            const currentUser = await tx.user.findUnique({
                where: { id: actualUserId }
            });

            if (!currentUser || currentUser.balance < totalCost) {
                throw new Error('INSUFFICIENT_FUNDS');
            }

            // Deduct balance
            const updatedUser = await tx.user.update({
                where: { id: actualUserId },
                data: { balance: { decrement: totalCost } }
            });

            // Upsert into UserInventory
            await tx.userInventory.upsert({
                where: {
                    userId_itemId: {
                        userId: actualUserId,
                        itemId: item.id
                    }
                },
                create: {
                    userId: actualUserId,
                    itemId: item.id,
                    quantity: quantity,
                    name: item.name,
                    typeCategory: item.type,
                    originalPrice: item.price,
                    ownershipStatus: 'Owned'
                },
                update: {
                    quantity: { increment: quantity },
                    ownershipStatus: 'Owned'
                }
            });

            return updatedUser.balance;
        });

        return {
            success: true,
            code: 'SUCCESS',
            message: `Purchase successful.`,
            item: {
                name: item.name,
                shortId: item.shortId,
                price: item.price,
                type: item.type
            },
            quantity,
            totalCost,
            remainingBalance: result
        };
    } catch (err: any) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return {
                success: false,
                code: 'INSUFFICIENT_BALANCE',
                message: `Insufficient balance to complete the purchase.`
            };
        }
        console.error('Error during purchase transaction:', err);
        return {
            success: false,
            code: 'DATABASE_ERROR',
            message: 'A database error occurred while processing the transaction.'
        };
    }
}
