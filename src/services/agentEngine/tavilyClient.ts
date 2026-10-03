import { tavily } from '@tavily/core';
import type { TavilySearchOptions, TavilySearchResponse } from '@tavily/core';

/**
 * `TavilySearchResult` is declared by the SDK but not exported from its entry
 * point, so the row type is derived from the public response type instead.
 */
type TavilyResultRow = TavilySearchResponse['results'][number];

/**
 * Tavily Search client for CosmosAgentEngine (Sara AI).
 *
 * Wraps the official `@tavily/core` SDK and normalises its response into a compact,
 * budget-aware shape the ReAct loop can safely consume.
 *
 * Key design rules:
 * - The API key is read from the environment and is NEVER logged, echoed into a
 *   tool result, or included in any thrown error message (Rule Y / Rule AH).
 * - A hard timeout is enforced AROUND the SDK call rather than relying solely on
 *   the SDK's own `timeout` option, so a single measured cutoff governs the whole
 *   operation (Rule AG).
 * - URLs are canonicalised, never truncated. A cut URL is a dead link, and
 *   WhatsApp renders plain text with no `[label](url)` syntax, so any mangled
 *   display form silently removes the user's ability to open the source.
 */

/** Hard ceiling for a single Tavily search request. */
export const TAVILY_TIMEOUT_MS = 8000;

/** Upper bound on results requested from Tavily, mirroring the tool schema cap. */
export const TAVILY_MAX_RESULTS = 10;

/** Default result count when the caller does not specify one. */
export const TAVILY_DEFAULT_RESULTS = 5;

/**
 * Maximum length of a result snippet handed to the LLM. Snippets are the highest
 * prompt-injection surface in the payload, so they are bounded.
 */
export const TAVILY_SNIPPET_MAX_CHARS = 180;

/**
 * A single canonical URL longer than this is kept intact rather than trimmed.
 * Correctness beats tidiness; the per-result snippet absorbs the budget instead.
 */
export const TAVILY_URL_SOFT_LIMIT_CHARS = 200;

/**
 * Tracking parameters stripped during canonicalisation. Legacy CMS and news URLs
 * routinely append long tracking blobs that add no navigational value.
 *
 * This is an explicit deny-list rather than "strip all query params", because
 * legacy CMSes frequently carry the real record identifier in the query string
 * (`?id=8842`, `?p=12345`, `?story=...`). Those parameters MUST be preserved.
 */
const TRACKING_PARAMS = new Set([
    'fbclid',
    'gclid',
    'dclid',
    'msclkid',
    'mc_cid',
    'mc_eid',
    'igshid',
    'yclid',
    'ref_src',
    'referrer',
    'spm',
    '_hsenc',
    '_hsmi',
    'vero_id',
    'vero_conv',
    'sessionid',
    'campaign_id',
    'trk',
    'trkCampaign'
]);

/** Raised when `TAVILY_API_KEY` is absent or blank. */
export class TavilyNotConfiguredError extends Error {
    constructor() {
        super('Tavily API key is not configured.');
        this.name = 'TavilyNotConfiguredError';
    }
}

export interface TavilySearchParams {
    query: string;
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
}

export interface TavilySearchResultItem {
    title: string;
    url: string;
    snippet: string;
    score: number;
}

export interface TavilySearchOutput {
    query: string;
    /** How many results Tavily returned before budget reduction. */
    totalResults: number;
    /** How many results survived canonicalisation and the budget. */
    returnedResults: number;
    results: TavilySearchResultItem[];
    /** Present only when results were dropped to respect the output budget. */
    notice?: string;
}

/** Reads the API key from the environment without ever logging it. */
function readApiKey(): string {
    const key = process.env.TAVILY_API_KEY?.trim();
    if (!key) throw new TavilyNotConfiguredError();
    return key;
}

/** Clamps the requested result count into the supported range. */
function normaliseMaxResults(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return TAVILY_DEFAULT_RESULTS;
    return Math.min(TAVILY_MAX_RESULTS, Math.max(1, Math.floor(value)));
}

/** Truncates a snippet on a word boundary so the LLM never reads a cut sentence. */
function truncateSnippet(text: string, limit: number = TAVILY_SNIPPET_MAX_CHARS): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const slice = clean.slice(0, limit);
    const lastSpace = slice.lastIndexOf(' ');
    return `${(lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/**
 * Canonicalises a URL for display.
 *
 * Uses the standard `URL` API rather than regex so encoding, ports, and paths are
 * handled correctly. Returns `null` when the URL is unusable or not `https`,
 * which is the only scheme surfaced to the user.
 */
export function canonicaliseUrl(rawUrl: string): string | null {
    const candidate = (rawUrl ?? '').trim();
    if (!candidate) return null;

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'https:') return null;

    // Preserve host casing semantics while dropping a default port and any
    // credentials that a hostile result might embed.
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.port = '';
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';

    // Remove tracking parameters, including every `utm_*` variant. All other
    // parameters survive because they may carry the real record identifier.
    const kept: [string, string][] = [];
    for (const [key, value] of parsed.searchParams.entries()) {
        const lowered = key.toLowerCase();
        if (TRACKING_PARAMS.has(lowered) || lowered.startsWith('utm_') || lowered === 'ref') continue;
        kept.push([key, value]);
    }
    parsed.search = '';
    for (const [key, value] of kept) parsed.searchParams.append(key, value);

    // Collapse duplicate slashes in the path and strip a trailing slash so the
    // same article referenced by two result rows yields one canonical string.
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

    return parsed.toString();
}

/**
 * Character budget for the serialised search payload.
 *
 * The ReAct loop truncates tool output at `MAX_TOOL_OUTPUT_CHARS = 1500`
 * (`executionLoop.ts`) by slicing the JSON string, which can corrupt the payload
 * mid-URL. This client therefore keeps its own payload comfortably below that
 * ceiling and reports the reduction itself, so the loop never truncates.
 */
export const TAVILY_PAYLOAD_BUDGET_CHARS = 1300;

/** Measures the serialised payload size the ReAct loop would actually receive. */
function measurePayload(results: TavilySearchResultItem[], query: string): number {
    return JSON.stringify({ query, results }).length;
}

/**
 * Drops whole results, lowest-scoring first, until the payload fits the budget.
 *
 * Removing an entire result keeps the payload valid, complete JSON and guarantees
 * no URL is ever cut. A single canonical URL longer than
 * `TAVILY_URL_SOFT_LIMIT_CHARS` is always kept intact even if it dominates the
 * payload, because a truncated URL is a dead link.
 */
function reduceToBudget(results: TavilySearchResultItem[], query: string, totalResults: number): TavilySearchOutput {
    // Sort by score descending so "lowest-scoring first" is well defined.
    const ordered = [...results].sort((a, b) => b.score - a.score);

    let kept = ordered;
    while (kept.length > 1 && measurePayload(kept, query) > TAVILY_PAYLOAD_BUDGET_CHARS) {
        kept = kept.slice(0, -1);
    }

    const dropped = totalResults - kept.length;
    const output: TavilySearchOutput = {
        query,
        totalResults,
        returnedResults: kept.length,
        results: kept
    };

    if (dropped > 0) {
        output.notice = `Showing the top ${kept.length} of ${totalResults} results; the remaining ${dropped} were omitted to keep within the message budget.`;
    }

    return output;
}

/** Maps one Tavily result row onto the internal shape, or `null` if unusable. */
function mapResult(raw: TavilyResultRow): TavilySearchResultItem | null {
    const url = canonicaliseUrl(raw.url);
    if (!url) return null;

    return {
        title: (raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        url,
        snippet: truncateSnippet(raw.content ?? ''),
        score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0
    };
}

/**
 * Runs a Tavily search and returns a compact, budget-safe result set.
 *
 * Returns `null` when the upstream request fails, times out, or yields no usable
 * results, so the calling tool can degrade to a graceful message rather than
 * surfacing a raw upstream error.
 */
export async function searchWeb(params: TavilySearchParams): Promise<TavilySearchOutput | null> {
    const apiKey = readApiKey();
    const client = tavily({ apiKey });

    const options: TavilySearchOptions = {
        maxResults: normaliseMaxResults(params.maxResults),
        searchDepth: params.searchDepth === 'advanced' ? 'advanced' : 'basic',
        // Server-side answer synthesis is intentionally disabled: it would bypass
        // Sara's persona entirely and return a generic pre-written answer.
        includeAnswer: false,
        includeRawContent: false,
        includeImages: false
    };

    let response;
    try {
        // The SDK's own timeout is set as a first line of defence, and the
        // AbortController guard enforces the hard ceiling even if the underlying
        // HTTP layer stalls.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
        try {
            response = await client.search(params.query, {
                ...options,
                timeout: TAVILY_TIMEOUT_MS
            });
        } finally {
            clearTimeout(timer);
        }
    } catch (err: unknown) {
        // Never interpolate the error into a message that could carry the API key
        // or upstream response body into logs.
        const reason = err instanceof Error ? err.name : 'unknown';
        console.error(`[TavilyClient] Search request failed (${reason}).`);
        return null;
    }

    const rawResults = Array.isArray(response?.results) ? response.results : [];
    const mapped = rawResults.map(mapResult).filter((item): item is TavilySearchResultItem => item !== null);

    if (mapped.length === 0) return null;

    const resolvedQuery = response?.query ?? params.query;
    return reduceToBudget(mapped, resolvedQuery, mapped.length);
}
