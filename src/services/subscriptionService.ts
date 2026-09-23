import crypto from 'crypto';
import { prisma } from '#db.js';
import { TIER_LIMITS, type SubscriptionTierName } from './quotaService.js';
import { formatRupiah } from '#utils/currency.js';

export const TIER_PRICES: Record<SubscriptionTierName, bigint> = {
    FREE: BigInt(0),
    SUBSIDIZED: BigInt(10000),
    PARTNER: BigInt(32000)
};

export function normalizeTier(raw: string): SubscriptionTierName | null {
    const v = raw.trim().toUpperCase();
    if (v === 'FREE' || v === 'SUBSIDIZED' || v === 'SUBSIDISED' || v === 'PARTNER') {
        return v === 'SUBSIDISED' ? 'SUBSIDIZED' : (v as SubscriptionTierName);
    }
    return null;
}

export function canonicalJidForPhone(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    return `${clean}@s.whatsapp.net`;
}

export function buildSalesLink(
    salesPhone: string,
    plan: SubscriptionTierName,
    targetNumber: string,
    t?: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string
): string {
    const orderRef = `COSMOS-SUB-${Math.floor(Date.now() / 1000)}`;
    const price = formatRupiah(Number(TIER_PRICES[plan]));
    const planName = plan.charAt(0) + plan.slice(1).toLowerCase();
    const message = t
        ? t('tools.sub.sales_message', {
              plan: planName,
              price,
              targetNumber,
              orderRef
          })
        : `Hello Cosmos Sales! I would like to subscribe to a paid tier.\n\n` +
          `Plan: ${planName} Tier\n` +
          `Price: ${price} / month\n` +
          `Target Number: ${targetNumber}\n` +
          `Order Ref: ${orderRef}\n\n` +
          `Please send the payment QRIS / account details.`;
    return `https://wa.me/${salesPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/**
 * Atomically activates (or renews) a subscription and logs a payment transaction.
 * Protected by the caller with executeWithUserLock to avoid TOCTOU races.
 */
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

export function renderUsageBar(current: number, max: number, width = 10): string {
    if (!Number.isFinite(max) || max <= 0) return `[${'▓'.repeat(width)}]`;
    const filled = Math.min(width, Math.round((current / max) * width));
    return `[${'▓'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}
