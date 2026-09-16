interface RateLimitEntry {
    timestamps: number[];
}

const PHONE_LIMIT = 3;
const IP_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const phoneStore = new Map<string, RateLimitEntry>();
const ipStore = new Map<string, RateLimitEntry>();

function pruneEntries(store: Map<string, RateLimitEntry>, now: number): void {
    for (const [key, entry] of store.entries()) {
        entry.timestamps = entry.timestamps.filter((ts) => now - ts < WINDOW_MS);
        if (entry.timestamps.length === 0) {
            store.delete(key);
        }
    }
}

export function checkAndConsumeRateLimit(
    phone: string,
    clientIp: string
): { allowed: boolean; retryAfter?: number; reason?: string } {
    const now = Date.now();
    pruneEntries(phoneStore, now);
    pruneEntries(ipStore, now);

    const cleanPhone = phone.replace(/\D/g, '');

    // Check phone throttle
    const phoneEntry = phoneStore.get(cleanPhone) ?? { timestamps: [] };
    const validPhoneTimes = phoneEntry.timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (validPhoneTimes.length >= PHONE_LIMIT) {
        const oldest = validPhoneTimes[0];
        const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
        return {
            allowed: false,
            retryAfter: Math.max(1, retryAfter),
            reason: `Too many requests for phone number. Please wait ${retryAfter}s.`
        };
    }

    // Check IP throttle
    const ipEntry = ipStore.get(clientIp) ?? { timestamps: [] };
    const validIpTimes = ipEntry.timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (validIpTimes.length >= IP_LIMIT) {
        const oldest = validIpTimes[0];
        const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
        return {
            allowed: false,
            retryAfter: Math.max(1, retryAfter),
            reason: `Too many requests from this IP address. Please wait ${retryAfter}s.`
        };
    }

    // Consume attempt
    validPhoneTimes.push(now);
    phoneStore.set(cleanPhone, { timestamps: validPhoneTimes });

    validIpTimes.push(now);
    ipStore.set(clientIp, { timestamps: validIpTimes });

    return { allowed: true };
}

export function resetRateLimits(): void {
    phoneStore.clear();
    ipStore.clear();
}
