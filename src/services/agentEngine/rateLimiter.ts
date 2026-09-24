/**
 * Sliding-window rate limiter and per-JID concurrency locks for CosmosAgentEngine.
 */

interface UserRateEntry {
    timestamps: number[];
    lastRequestAt: number;
}

const WINDOW_MS = 60_000; // 60 seconds
const MAX_REQUESTS_PER_WINDOW = 3;
const MIN_COOLDOWN_MS = 5_000; // 5-second minimum cooldown between consecutive requests
const MAX_CONTEXT_TOKENS = 4_000;

export class AgentRateLimiter {
    private static userRateMap = new Map<string, UserRateEntry>();
    private static activeJidLocks = new Set<string>();

    /**
     * Checks if a user is within sliding-window rate limits and cooldown.
     * Returns { allowed: true } or { allowed: false, reason: string, retryAfterSec: number }.
     */
    public static checkUserLimit(callerJid: string): {
        allowed: boolean;
        reason?: string;
        retryAfterSec?: number;
    } {
        const now = Date.now();
        const entry = this.userRateMap.get(callerJid) || { timestamps: [], lastRequestAt: 0 };

        // 1. Check minimum consecutive cooldown
        if (entry.lastRequestAt > 0 && now - entry.lastRequestAt < MIN_COOLDOWN_MS) {
            const waitSec = Math.ceil((MIN_COOLDOWN_MS - (now - entry.lastRequestAt)) / 1000);
            return {
                allowed: false,
                reason: 'COOLDOWN',
                retryAfterSec: waitSec
            };
        }

        // 2. Filter sliding window timestamps
        const validTimestamps = entry.timestamps.filter((ts) => now - ts < WINDOW_MS);

        if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
            const oldest = validTimestamps[0];
            const waitSec = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
            return {
                allowed: false,
                reason: 'RATE_LIMIT_EXCEEDED',
                retryAfterSec: waitSec
            };
        }

        return { allowed: true };
    }

    /**
     * Records an authorized request timestamp for a caller.
     */
    public static recordRequest(callerJid: string): void {
        const now = Date.now();
        const entry = this.userRateMap.get(callerJid) || { timestamps: [], lastRequestAt: 0 };
        const validTimestamps = entry.timestamps.filter((ts) => now - ts < WINDOW_MS);
        validTimestamps.push(now);

        this.userRateMap.set(callerJid, {
            timestamps: validTimestamps,
            lastRequestAt: now
        });
    }

    /**
     * Acquires a chat-level concurrency lock on a JID to prevent duplicate Baileys sync execution.
     */
    public static acquireJidLock(chatJid: string): boolean {
        if (this.activeJidLocks.has(chatJid)) {
            return false;
        }
        this.activeJidLocks.add(chatJid);
        return true;
    }

    /**
     * Releases a chat-level concurrency lock.
     */
    public static releaseJidLock(chatJid: string): void {
        this.activeJidLocks.delete(chatJid);
    }

    /**
     * Validates estimated cumulative tokens against maximum context budget (< 4,000 tokens).
     */
    public static isWithinContextBudget(estimatedTokens: number): boolean {
        return estimatedTokens <= MAX_CONTEXT_TOKENS;
    }

    /**
     * Resets rate limiter state (for tests).
     */
    public static clearAll(): void {
        this.userRateMap.clear();
        this.activeJidLocks.clear();
    }
}
