/**
 * Shared resilient HTTP POST helper for status transports.
 *
 * Implements a 3-attempt (configurable) exponential backoff with:
 *  - per-request timeout via AbortSignal
 *  - explicit handling of HTTP 429 using the `retry_after` / `Retry-After` hint
 *  - non-throwing contract: returns a result rather than rejecting so transports
 *    can never crash the socket loop.
 */
import axios from 'axios';
import { getStatusNotifierConfig } from '../config.js';

export interface HttpPostResult {
    success: boolean;
    attempts: number;
    status?: number;
    error?: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headers: Record<string, unknown> | undefined, data: unknown): number | null {
    const headerValue = headers?.['retry-after'];
    if (typeof headerValue === 'string' && headerValue.trim() !== '') {
        const seconds = Number(headerValue);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    }
    if (headers?.['x-ratelimit-reset-after']) {
        const seconds = Number(headers['x-ratelimit-reset-after']);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    }
    if (data && typeof data === 'object' && 'retry_after' in data) {
        const seconds = Number((data as { retry_after?: unknown }).retry_after);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    }
    return null;
}

/**
 * POSTs JSON with bounded retries. Never rejects; returns a structured result.
 */
export async function postJsonWithRetry(
    url: string,
    body: unknown,
    options: { label: string; maxAttempts?: number; timeoutMs?: number } = { label: 'http' }
): Promise<HttpPostResult> {
    const config = getStatusNotifierConfig();
    const maxAttempts = options.maxAttempts ?? config.maxAttempts;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;

    let lastError: string | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await axios.post(url, body, {
                headers: { 'Content-Type': 'application/json' },
                timeout: timeoutMs,
                signal: AbortSignal.timeout(timeoutMs),
                validateStatus: () => true
            });

            lastStatus = response.status;
            if (response.status >= 200 && response.status < 300) {
                return { success: true, attempts: attempt, status: response.status };
            }

            lastError = `HTTP ${response.status}`;
            if (response.status === 429) {
                const retryAfterMs = parseRetryAfter(response.headers as Record<string, unknown>, response.data);
                if (retryAfterMs !== null && attempt < maxAttempts) {
                    console.warn(`[StatusNotifier:${options.label}] rate limited, retrying in ${retryAfterMs}ms.`);
                    await sleep(retryAfterMs);
                    continue;
                }
            }

            // 4xx (other than 429) are not retryable.
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                return { success: false, attempts: attempt, status: response.status, error: lastError };
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }

        if (attempt < maxAttempts) {
            const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
            await sleep(backoffMs);
        }
    }

    return { success: false, attempts: maxAttempts, status: lastStatus, error: lastError };
}
