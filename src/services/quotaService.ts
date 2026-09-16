import { prisma } from '#db.js';

export type SubscriptionTierName = 'FREE' | 'SUBSIDIZED' | 'PARTNER';

export interface UserQuotaOverview {
    userJid: string;
    tier: SubscriptionTierName;
    isOwner: boolean;
    expiresAt: Date | null;
    groups: { current: number; max: number; available: number };
    subBots: { current: number; max: number; available: number };
    customPrefixAllowed: boolean;
    economyMultiplier: number;
}

export interface QuotaCheckResult {
    allowed: boolean;
    current: number;
    max: number;
    tier: string;
    reason?: string;
}

export const TIER_LIMITS: Record<
    SubscriptionTierName,
    { maxGroups: number; maxSubBots: number; customPrefix: boolean; economyMultiplier: number }
> = {
    FREE: { maxGroups: 5, maxSubBots: 2, customPrefix: false, economyMultiplier: 1.0 },
    SUBSIDIZED: { maxGroups: 10, maxSubBots: 5, customPrefix: true, economyMultiplier: 1.05 },
    PARTNER: { maxGroups: 25, maxSubBots: 12, customPrefix: true, economyMultiplier: 1.15 }
};

// In-flight user lock mutex to prevent concurrent TOCTOU quota race conditions.
const userLocks = new Set<string>();

export async function executeWithUserLock<T>(userJid: string, action: () => Promise<T>): Promise<T> {
    if (userLocks.has(userJid)) {
        throw new Error('CONCURRENT_ACTION_IN_PROGRESS: Another quota-sensitive operation is already processing.');
    }
    userLocks.add(userJid);
    try {
        return await action();
    } finally {
        userLocks.delete(userJid);
    }
}

export class QuotaService {
    static async getUserQuota(userJid: string, isOwner = false): Promise<UserQuotaOverview> {
        if (isOwner) {
            const groups = await prisma.whitelistedGroup.count().catch(() => 0);
            return {
                userJid,
                tier: 'PARTNER',
                isOwner: true,
                expiresAt: null,
                groups: { current: groups, max: Infinity, available: Infinity },
                subBots: { current: 0, max: Infinity, available: Infinity },
                customPrefixAllowed: true,
                economyMultiplier: 1.0
            };
        }

        const sub = await prisma.subscription.findUnique({ where: { userId: userJid } }).catch(() => null);
        const isActive = sub && sub.status === 'ACTIVE' && (!sub.expiresAt || sub.expiresAt.getTime() > Date.now());
        const tier = (isActive ? (sub.tier as SubscriptionTierName) : 'FREE') as SubscriptionTierName;
        const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.FREE;
        const maxGroups = isActive ? Number((sub as { maxGroups: number }).maxGroups) : limits.maxGroups;
        const maxSubBots = isActive ? Number((sub as { maxSubBots: number }).maxSubBots) : limits.maxSubBots;
        const customPrefix = isActive ? Boolean((sub as { customPrefix: boolean }).customPrefix) : limits.customPrefix;

        const currentGroups = await prisma.whitelistedGroup.count({ where: { ownerJid: userJid } }).catch(() => 0);
        const currentSubBots = await prisma.subBotInstance
            .count({ where: { ownerJid: userJid, status: 'ACTIVE' } })
            .catch(() => 0);

        return {
            userJid,
            tier,
            isOwner: false,
            expiresAt: (sub?.expiresAt as Date | null | undefined) ?? null,
            groups: { current: currentGroups, max: maxGroups, available: Math.max(0, maxGroups - currentGroups) },
            subBots: { current: currentSubBots, max: maxSubBots, available: Math.max(0, maxSubBots - currentSubBots) },
            customPrefixAllowed: customPrefix,
            economyMultiplier: limits.economyMultiplier
        };
    }

    static async canAddGroup(userJid: string, isOwner = false): Promise<QuotaCheckResult> {
        if (isOwner) return { allowed: true, current: 0, max: Infinity, tier: 'ADMIN' };
        const quota = await this.getUserQuota(userJid, isOwner);
        if (quota.groups.current >= quota.groups.max) {
            return {
                allowed: false,
                current: quota.groups.current,
                max: quota.groups.max,
                tier: quota.tier,
                reason: `Maximum group limit reached for ${quota.tier} tier (${quota.groups.current}/${quota.groups.max}).`
            };
        }
        return { allowed: true, current: quota.groups.current, max: quota.groups.max, tier: quota.tier };
    }

    static async canPairSubBot(userJid: string, isOwner = false): Promise<QuotaCheckResult> {
        if (isOwner) return { allowed: true, current: 0, max: Infinity, tier: 'ADMIN' };
        const quota = await this.getUserQuota(userJid, isOwner);
        if (quota.subBots.current >= quota.subBots.max) {
            return {
                allowed: false,
                current: quota.subBots.current,
                max: quota.subBots.max,
                tier: quota.tier,
                reason: `Maximum active sub-bot limit reached for ${quota.tier} tier (${quota.subBots.current}/${quota.subBots.max}).`
            };
        }
        return { allowed: true, current: quota.subBots.current, max: quota.subBots.max, tier: quota.tier };
    }
}
