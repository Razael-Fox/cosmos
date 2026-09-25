import { isOwnerId } from '../owner.js';

export interface AntiSpamResult {
    isSpam: boolean;
    rate: number;
    action: 'ALLOW' | 'THROTTLE' | 'BLOCK';
    reason?: string;
}

interface WindowTracker {
    timestamps: number[];
    offenseCount: number;
    lastOffenseTime: number;
}

// Maximum entries in the tracker to prevent unbounded heap growth
const MAX_TRACKER_ENTRIES = 5000;
const BURST_WINDOW_MS = 3000;
const BURST_MAX_COUNT = 6;
const SUSTAINED_WINDOW_MS = 10000;
const SUSTAINED_MAX_COUNT = 15;
const OFFENSE_DECAY_MS = 30000;

class AntiSpamGuard {
    private trackers: Map<string, WindowTracker> = new Map();
    private lastCleanupTime = Date.now();

    /**
     * Checks if the sender is exceeding burst or sustained rate thresholds.
     */
    public checkRate(senderJid: string, isOwner?: boolean): AntiSpamResult {
        if (!senderJid) {
            return { isSpam: false, rate: 0, action: 'ALLOW' };
        }

        const isPrivileged = isOwner ?? isOwnerId(senderJid);
        if (isPrivileged) {
            return { isSpam: false, rate: 0, action: 'ALLOW' };
        }

        const now = Date.now();
        this.periodicCleanup(now);

        let tracker = this.trackers.get(senderJid);
        if (!tracker) {
            if (this.trackers.size >= MAX_TRACKER_ENTRIES) {
                this.evictOldest();
            }
            tracker = {
                timestamps: [],
                offenseCount: 0,
                lastOffenseTime: 0
            };
            this.trackers.set(senderJid, tracker);
        }

        // Decay offenses if enough time has passed
        if (tracker.offenseCount > 0 && now - tracker.lastOffenseTime > OFFENSE_DECAY_MS) {
            tracker.offenseCount = Math.max(0, tracker.offenseCount - 1);
        }

        // Add current timestamp and prune timestamps older than sustained window
        tracker.timestamps.push(now);
        tracker.timestamps = tracker.timestamps.filter((ts) => now - ts <= SUSTAINED_WINDOW_MS);

        // Count messages in short burst window
        const burstCount = tracker.timestamps.filter((ts) => now - ts <= BURST_WINDOW_MS).length;
        const sustainedCount = tracker.timestamps.length;

        // Evaluate violation
        if (burstCount > BURST_MAX_COUNT) {
            tracker.offenseCount++;
            tracker.lastOffenseTime = now;

            if (tracker.offenseCount >= 3) {
                return {
                    isSpam: true,
                    rate: burstCount,
                    action: 'BLOCK',
                    reason: `Severe spam burst: ${burstCount} messages within 3s (${tracker.offenseCount} consecutive offenses)`
                };
            }

            return {
                isSpam: true,
                rate: burstCount,
                action: 'THROTTLE',
                reason: `Rate limit burst exceeded: ${burstCount} messages within 3s`
            };
        }

        if (sustainedCount > SUSTAINED_MAX_COUNT) {
            tracker.offenseCount++;
            tracker.lastOffenseTime = now;

            if (tracker.offenseCount >= 3) {
                return {
                    isSpam: true,
                    rate: sustainedCount,
                    action: 'BLOCK',
                    reason: `Severe sustained flood: ${sustainedCount} messages within 10s (${tracker.offenseCount} consecutive offenses)`
                };
            }

            return {
                isSpam: true,
                rate: sustainedCount,
                action: 'THROTTLE',
                reason: `Sustained rate limit exceeded: ${sustainedCount} messages within 10s`
            };
        }

        return {
            isSpam: false,
            rate: burstCount,
            action: 'ALLOW'
        };
    }

    /**
     * Resets tracker for a specific JID.
     */
    public reset(senderJid: string): void {
        this.trackers.delete(senderJid);
    }

    /**
     * Clears all in-memory trackers.
     */
    public clear(): void {
        this.trackers.clear();
    }

    /**
     * Evicts stale trackers every 60 seconds.
     */
    private periodicCleanup(now: number): void {
        if (now - this.lastCleanupTime < 60000) {
            return;
        }
        this.lastCleanupTime = now;

        for (const [jid, tracker] of this.trackers.entries()) {
            if (
                tracker.timestamps.length === 0 ||
                now - tracker.timestamps[tracker.timestamps.length - 1] > SUSTAINED_WINDOW_MS * 2
            ) {
                this.trackers.delete(jid);
            }
        }
    }

    /**
     * Evicts oldest 10% of entries when tracker size reaches MAX_TRACKER_ENTRIES.
     */
    private evictOldest(): void {
        const toDeleteCount = Math.floor(MAX_TRACKER_ENTRIES * 0.1);
        let deleted = 0;
        for (const key of this.trackers.keys()) {
            this.trackers.delete(key);
            deleted++;
            if (deleted >= toDeleteCount) break;
        }
    }
}

export const antiSpamGuard = new AntiSpamGuard();
