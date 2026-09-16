import crypto from 'crypto';
import { prisma } from '../db.js';
import { TIER_LIMITS, TIER_PRICES, type SubscriptionTierName } from './quotaService.js';

export function normalizeTier(raw: string): SubscriptionTierName | null {
    const v = raw.trim().toUpperCase();
    if (v === 'FREE' || v === 'SUBSIDIZED' || v === 'SUBSIDISED' || v === 'PARTNER') {
        return v === 'SUBSIDISED' ? 'SUBSIDIZED' : (v as SubscriptionTierName);
    }
    return null;
}

export function formatRupiah(amount: number): string {
    return `Rp${amount.toLocaleString('id-ID')}`;
}

export function buildSalesLink(
    salesPhone: string,
    plan: SubscriptionTierName,
    targetNumber: string
): { salesUrl: string; orderRef: string } {
    const orderRef = `COSMOS-SUB-${Math.floor(Date.now() / 1000)}`;
    const price = formatRupiah(Number(TIER_PRICES[plan]));
    const message =
        `Hello Cosmos Sales! I would like to subscribe to a paid tier.\n\n` +
        `Plan: ${plan.charAt(0) + plan.slice(1).toLowerCase()} Tier\n` +
        `Price: ${price} / month\n` +
        `Target Number: ${targetNumber}\n` +
        `Order Ref: ${orderRef}\n\n` +
        `Please send the payment QRIS / account details.`;
    const salesUrl = `https://wa.me/${salesPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    return { salesUrl, orderRef };
}

export async function activateSubscription(
    userJid: string,
    tier: SubscriptionTierName,
    durationDays: number,
    confirmedBy: string,
    notes?: string
): Promise<{ expiresAt: Date | null; orderRef: string }> {
    const limits = TIER_LIMITS[tier];
    const now = new Date();
    const existing = await prisma.subscription.findUnique({ where: { userId: userJid } }).catch(() => null);
    const base = existing?.expiresAt && existing.expiresAt.getTime() > now.getTime() ? existing.expiresAt : now;
    const expiresAt = tier === 'FREE' ? null : new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const orderRef = `COSMOS-SUB-${Math.floor(Date.now() / 1000)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    await prisma.$transaction(async (tx) => {
        await tx.subscription.upsert({
            where: { userId: userJid },
            update: {
                tier,
                status: 'ACTIVE',
                maxSubBots: limits.maxSubBots,
                maxGroups: limits.maxGroups,
                customPrefix: limits.customPrefix,
                startedAt: existing ? (existing as { startedAt: Date }).startedAt : now,
                expiresAt
            },
            create: {
                userId: userJid,
                tier,
                status: 'ACTIVE',
                maxSubBots: limits.maxSubBots,
                maxGroups: limits.maxGroups,
                customPrefix: limits.customPrefix,
                startedAt: now,
                expiresAt
            }
        });
        const subscription = await tx.subscription.findUniqueOrThrow({ where: { userId: userJid } });
        await tx.paymentTransaction.create({
            data: {
                subscriptionId: (subscription as { id: string }).id,
                userId: userJid,
                tier,
                amount: TIER_PRICES[tier] * BigInt(Math.max(1, Math.round(durationDays / 30))),
                status: 'PAID',
                paymentMethod: 'MANUAL_WHATSAPP',
                confirmedBy,
                orderRef,
                notes: notes ?? null,
                paidAt: now
            }
        });
    });

    return { expiresAt, orderRef };
}
