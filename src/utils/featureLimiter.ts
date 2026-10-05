import { prisma } from '#db.js';
import { isOwnerId } from './owner.js';
import { TIER_LIMITS, type SubscriptionTierName, type FeatureLimit } from '../services/quotaService.js';
import type { ToolDefinition } from '../tools/types.js';

export type { FeatureLimit };

export interface ResolvedLimit {
    tier: SubscriptionTierName;
    /** Counter key prefix: the feature class when declared, otherwise the tool name. */
    key: string;
    limit: FeatureLimit;
}

/** Hard ceiling on tracked keys so a key spray cannot grow the heap without bound. */
const MAX_TRACKED_KEYS = 5000;
/** Tier staleness window; the IPC activation hook invalidates eagerly on upgrade. */
const TIER_CACHE_TTL_MS = 60_000;

const hits = new Map<string, number[]>();
const tierCache = new Map<string, { tier: SubscriptionTierName; at: number }>();

/**
 * Sliding-window counter. Consumes one slot when the window still has room,
 * otherwise leaves the window untouched and reports failure.
 */
export function tryConsume(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const window = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (window.length >= max) {
        hits.set(key, window);
        return false;
    }
    window.push(now);
    hits.set(key, window);
    if (hits.size >= MAX_TRACKED_KEYS) evictOldestKeys();
    return true;
}

/** Hits recorded for `key` inside the current window. Used by `.my quota`. */
export function usageInWindow(key: string, windowMs: number): number {
    const now = Date.now();
    return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
}

/** Drops the cached tier for one JID, or the whole cache when called without an argument. */
export function invalidateTierCache(userJid?: string): void {
    if (userJid) tierCache.delete(userJid);
    else tierCache.clear();
}

/**
 * Reads the subscriber tier with a single `findUnique` per JID per TTL, instead of the three
 * queries `QuotaService.getUserQuota()` performs. No active row means FREE.
 */
export async function getTierCached(userJid: string): Promise<SubscriptionTierName> {
    const cached = tierCache.get(userJid);
    const now = Date.now();
    if (cached && now - cached.at < TIER_CACHE_TTL_MS) return cached.tier;

    const sub = await prisma.subscription.findUnique({ where: { userId: userJid } }).catch(() => null);
    const isActive = sub && sub.status === 'ACTIVE' && (!sub.expiresAt || sub.expiresAt.getTime() > now);
    const tier = (isActive ? (sub.tier as SubscriptionTierName) : 'FREE') as SubscriptionTierName;
    tierCache.set(userJid, { tier, at: now });
    return tier;
}

/**
 * Resolves the ceiling for one invocation, or null when the invocation is unlimited.
 * Order: owner bypass, tool opts out, tier value, tool fallback.
 */
export async function resolveLimit(def: ToolDefinition, userJid: string): Promise<ResolvedLimit | null> {
    if (!def.limit) return null;
    if (isOwnerId(userJid)) return null;

    const tier = await getTierCached(userJid);
    const key = def.limitKey ?? def.name;
    return { tier, key, limit: TIER_LIMITS[tier]?.featureLimits?.[key] ?? def.limit };
}

/** Feature ceilings configured for a tier, in display order. */
export function tierFeatureLimits(tier: SubscriptionTierName): Array<[string, FeatureLimit]> {
    return Object.entries(TIER_LIMITS[tier]?.featureLimits ?? {});
}

/** ponytail: oldest-10% eviction, same discipline as antiSpamGuard. Per-user eviction once
 *  the cap is hit is acceptable at this scale; switch to per-JID keys if usage ever grows. */
function evictOldestKeys(): void {
    const toDelete = Math.floor(MAX_TRACKED_KEYS * 0.1);
    let deleted = 0;
    for (const key of hits.keys()) {
        hits.delete(key);
        if (++deleted >= toDelete) break;
    }
}
