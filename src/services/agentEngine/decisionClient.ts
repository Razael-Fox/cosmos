import { SaraPromptContext } from './types.js';

export interface DecisionIntentResult {
    intent: 'send_message' | 'send_location' | 'check_balance' | 'bank_action' | 'conversation';
    recipientCategory: 'contact' | 'group' | 'none';
    confidence: number;
    probabilities?: Record<string, number>;
    source: 'laya' | 'fallback';
}

export interface DecisionLoanResult {
    recommendation: 'approved' | 'rejected';
    riskTier: 'low' | 'moderate' | 'high' | 'prohibitive';
    suggestedInterestRate: number;
    suggestedTermDays: number;
    confidence: number;
    source: 'laya' | 'fallback';
}

export class DecisionClient {
    private static readonly TIMEOUT_MS = 3000;

    /**
     * Resolves the API Gateway base URL.
     */
    public static getApiBaseUrl(): string {
        const defaultHost = process.env.NODE_ENV === 'development' ? 'api' : '127.0.0.1';
        return (
            process.env.INTERNAL_API_URL ||
            `http://${process.env.API_HOST || defaultHost}:${process.env.API_PORT || '4000'}`
        );
    }

    /**
     * Sanitizes untrusted user content by strictly stripping raw phone numbers, user JIDs,
     * bank balances, and mapping contact/group aliases to ephemeral RAM nonces (Rule AB).
     */
    public static sanitizeUntrustedContent(rawText: string, ctx?: SaraPromptContext): string {
        if (!rawText) return '';

        let sanitized = rawText;

        // 1. Strip raw JIDs: e.g. 628123456789@s.whatsapp.net, 123456@g.us, @lid
        sanitized = sanitized.replace(/\b\d{8,16}@(?:s\.whatsapp\.net|g\.us|lid)\b/gi, '[MASKED_JID]');

        // 2. Strip international phone numbers (+62..., 08...)
        sanitized = sanitized.replace(/(?:\+?62|08)[0-9]{8,13}\b/g, '[MASKED_PHONE]');

        // 3. Strip currency values to prevent financial profile leakage
        sanitized = sanitized.replace(/Rp\s*[\d.,]+/gi, '[MASKED_AMOUNT]');

        // 4. Map known contact and group aliases to their zero-knowledge ephemeral tokens
        if (ctx) {
            if (ctx.knownContactTokens) {
                for (const item of ctx.knownContactTokens) {
                    if (item.alias && item.alias.length >= 2) {
                        const escaped = item.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const re = new RegExp(`\\b${escaped}\\b`, 'gi');
                        sanitized = sanitized.replace(re, item.token);
                    }
                }
            }
            if (ctx.knownGroupTokens) {
                for (const item of ctx.knownGroupTokens) {
                    if (item.groupName && item.groupName.length >= 2) {
                        const escaped = item.groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const re = new RegExp(`\\b${escaped}\\b`, 'gi');
                        sanitized = sanitized.replace(re, item.token);
                    }
                }
            }
        }

        return sanitized.trim();
    }

    /**
     * Calls POST /api/v1/decision/intent on Cosmos API Gateway with hard timeout and fallback.
     */
    public static async queryIntent(prompt: string, ctx: SaraPromptContext): Promise<DecisionIntentResult | null> {
        try {
            const sanitizedState = this.sanitizeUntrustedContent(prompt, ctx);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (process.env.INTERNAL_IPC_SECRET) {
                headers['x-internal-secret'] = process.env.INTERNAL_IPC_SECRET;
            }

            const url = `${this.getApiBaseUrl()}/api/v1/decision/intent`;
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ state: sanitizedState }),
                signal: controller.signal
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                console.warn(`[DecisionClient] Intent query returned status ${res.status}`);
                return null;
            }

            const body = (await res.json()) as { ok?: boolean; data?: DecisionIntentResult };
            if (body.ok && body.data) {
                return body.data;
            }
            return null;
        } catch (err) {
            console.warn('[DecisionClient] Intent decision service unavailable or timed out:', err);
            return null;
        }
    }

    /**
     * Calls POST /api/v1/decision/loan on Cosmos API Gateway.
     */
    public static async evaluateLoan(metrics: {
        creditScore: number;
        reputation: 'Poor' | 'Fair' | 'Good' | 'Excellent';
        netWorthTier: 'low' | 'medium' | 'high' | 'ultra';
        requestedAmount: number;
        pastRepaymentsCount: number;
        pastDefaultsCount: number;
        hasCollateral: boolean;
    }): Promise<DecisionLoanResult | null> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            if (process.env.INTERNAL_IPC_SECRET) {
                headers['x-internal-secret'] = process.env.INTERNAL_IPC_SECRET;
            }

            const url = `${this.getApiBaseUrl()}/api/v1/decision/loan`;
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(metrics),
                signal: controller.signal
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                console.warn(`[DecisionClient] Loan query returned status ${res.status}`);
                return null;
            }

            const body = (await res.json()) as { ok?: boolean; data?: DecisionLoanResult };
            if (body.ok && body.data) {
                return body.data;
            }
            return null;
        } catch (err) {
            console.warn('[DecisionClient] Loan decision service unavailable or timed out:', err);
            return null;
        }
    }
}
