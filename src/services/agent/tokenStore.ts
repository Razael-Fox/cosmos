import crypto from 'crypto';

interface EphemeralTokenEntry {
    token: string;
    realJid: string;
    callerJid: string;
    allowedTools: Set<string>;
    createdAt: number;
    expiresAt: number;
    consumed: boolean;
}

const DEFAULT_TTL_MS = 180_000; // 3 minutes
const MAX_GLOBAL_TOKENS = 10_000;
const MAX_USER_TOKENS = 10;

/**
 * Zero-Knowledge Ephemeral Token Store.
 * Maps cryptographically random 128-bit nonces to real WhatsApp JIDs in RAM.
 * Raw phone numbers are NEVER exposed to the LLM.
 */
export class EphemeralTokenStore {
    // Primary store: token -> entry
    private static tokens = new Map<string, EphemeralTokenEntry>();
    // User index: callerJid -> Set<token>
    private static userTokens = new Map<string, Set<string>>();

    /**
     * Mints a cryptographically random, zero-knowledge token bound to a caller.
     */
    public static mintToken(
        realJid: string,
        callerJid: string,
        allowedTools: Set<string> = new Set(['send_message', 'send_location'])
    ): string {
        this.cleanExpiredTokens();

        // Enforce per-user token ceiling (max 10) with FIFO/LRU eviction
        const existingUserSet = this.userTokens.get(callerJid) || new Set<string>();
        if (existingUserSet.size >= MAX_USER_TOKENS) {
            const oldestToken = existingUserSet.values().next().value;
            if (oldestToken) {
                this.deleteToken(oldestToken);
            }
        }

        // Enforce global token capacity (max 10,000)
        if (this.tokens.size >= MAX_GLOBAL_TOKENS) {
            const oldestGlobal = this.tokens.keys().next().value;
            if (oldestGlobal) {
                this.deleteToken(oldestGlobal);
            }
        }

        const nonce = crypto.randomBytes(16).toString('hex');
        const token = `contact_ref_${nonce}`;
        const now = Date.now();

        const entry: EphemeralTokenEntry = {
            token,
            realJid,
            callerJid,
            allowedTools,
            createdAt: now,
            expiresAt: now + DEFAULT_TTL_MS,
            consumed: false
        };

        this.tokens.set(token, entry);

        let userSet = this.userTokens.get(callerJid);
        if (!userSet) {
            userSet = new Set<string>();
            this.userTokens.set(callerJid, userSet);
        }
        userSet.add(token);

        return token;
    }

    /**
     * Resolves a token to a real JID in RAM.
     * Verifies that:
     * 1. Token exists and is not expired.
     * 2. Caller matches token.callerJid.
     * 3. The requested tool is permitted under token.allowedTools.
     */
    public static resolveToken(token: string, callerJid: string, toolName?: string): string | null {
        if (!token || typeof token !== 'string') return null;

        const entry = this.tokens.get(token);
        if (!entry) return null;

        // Verify expiration
        if (Date.now() > entry.expiresAt) {
            this.deleteToken(token);
            return null;
        }

        // Caller verification (prevent cross-user token hijacking/replay)
        if (entry.callerJid !== callerJid) {
            console.warn(
                `[EphemeralTokenStore] Security Alert: Unauthorized caller ${callerJid} attempted to access token ${token} belonging to ${entry.callerJid}`
            );
            return null;
        }

        // Capability scope verification
        if (toolName && !entry.allowedTools.has(toolName)) {
            console.warn(`[EphemeralTokenStore] Security Alert: Tool ${toolName} is not permitted for token ${token}`);
            return null;
        }

        return entry.realJid;
    }

    /**
     * Checks if a token is valid, active, unconsumed, and accessible by the caller.
     */
    public static isValidToken(token: string, callerJid: string, toolName?: string): boolean {
        if (!token || typeof token !== 'string') return false;

        const entry = this.tokens.get(token);
        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this.deleteToken(token);
            return false;
        }

        if (entry.callerJid !== callerJid) {
            return false;
        }

        if (toolName && !entry.allowedTools.has(toolName)) {
            return false;
        }

        return !entry.consumed;
    }

    /**
     * Marks a token as consumed upon terminal execution.
     */
    public static consumeToken(token: string, callerJid: string): void {
        const entry = this.tokens.get(token);
        if (entry && entry.callerJid === callerJid) {
            entry.consumed = true;
            this.deleteToken(token);
        }
    }

    /**
     * Evicts expired tokens from memory.
     */
    public static cleanExpiredTokens(): void {
        const now = Date.now();
        for (const [token, entry] of this.tokens.entries()) {
            if (now > entry.expiresAt) {
                this.deleteToken(token);
            }
        }
    }

    /**
     * Deletes a token and updates the user index.
     */
    private static deleteToken(token: string): void {
        const entry = this.tokens.get(token);
        if (entry) {
            const userSet = this.userTokens.get(entry.callerJid);
            if (userSet) {
                userSet.delete(token);
                if (userSet.size === 0) {
                    this.userTokens.delete(entry.callerJid);
                }
            }
            this.tokens.delete(token);
        }
    }

    /**
     * Clears all tokens (for test teardown).
     */
    public static clearAll(): void {
        this.tokens.clear();
        this.userTokens.clear();
    }

    /**
     * Returns the current count of active tokens in RAM.
     */
    public static getActiveCount(): number {
        return this.tokens.size;
    }
}
