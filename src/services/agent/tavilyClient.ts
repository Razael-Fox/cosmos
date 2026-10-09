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
 * - The deadline is enforced by the SDK's own `timeout` option, which is expressed
 *   in SECONDS. No `AbortController` is used: the SDK accepts no `signal`, so one
 *   would abort nothing while appearing to provide a safety net (Rule AG).
 * - URLs are canonicalised, never truncated. A cut URL is a dead link, and
 *   WhatsApp renders plain text with no `[label](url)` syntax, so any mangled
 *   display form silently removes the user's ability to open the source.
 */

/**
 * Hard ceiling for a single Tavily search request, expressed in milliseconds.
 *
 * NOTE: `@tavily/core` expects its `timeout` option in SECONDS, not milliseconds
 * (see `index.mjs`: `timeoutInMillis = requestTimeout * 1e3`). Passing a raw
 * millisecond value here would silently become 8,000,000 ms (~2h13m). Conversion
 * happens once, in `searchWeb`, and is covered by `SECONDS_PER_TIMEOUT_MS`.
 */
export const TAVILY_TIMEOUT_MS = 8000;

/** Conversion factor between our millisecond budget and the SDK's second-based option. */
const SECONDS_PER_TIMEOUT_MS = 1000;

/**
 * SDK `timeout` value in seconds. Derived rather than hardcoded so the two can
 * never drift apart.
 */
const TAVILY_TIMEOUT_SECONDS = Math.ceil(TAVILY_TIMEOUT_MS / SECONDS_PER_TIMEOUT_MS);

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
 * Hard ceiling on a single canonical URL.
 *
 * This is enforced, not advisory: a result whose canonical URL exceeds this is
 * DISCARDED rather than trimmed. Trimming would produce a dead link, and letting
 * an oversized URL through would let the ReAct loop's blunt
 * `slice(0, MAX_TOOL_OUTPUT_CHARS)` cut a URL in half — the exact failure this
 * module exists to prevent. Dropping the source is the only safe option, and the
 * remaining results still render.
 */
export const TAVILY_URL_MAX_CHARS = 200;

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

/**
 * Discriminated outcome of a search.
 *
 * A bare `null` previously conflated "Tavily is unreachable" with "nothing
 * matched", which reported an outage to the user as a bad query and made the
 * `web_search_failed` locale key unreachable. These cases are now distinct so the
 * caller can respond honestly and so operators get a usable signal.
 */
export type TavilyOutcome =
    | { kind: 'ok'; output: TavilySearchOutput }
    | { kind: 'empty' }
    | { kind: 'unavailable'; reason: TavilyUnavailableReason };

/** Why the upstream search could not be completed. */
export type TavilyUnavailableReason = 'timeout' | 'auth' | 'rate_limited' | 'network';

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
 * no URL is ever cut.
 *
 * Because `mapResult` already discards any URL longer than
 * `TAVILY_URL_MAX_CHARS`, and the other two fields are hard-capped, a single
 * surviving result can never on its own exceed the ReAct loop's
 * `MAX_TOOL_OUTPUT_CHARS`. That is what makes the `length > 1` floor safe here.
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

/**
 * Maps one Tavily result row onto the internal shape, or `null` if unusable.
 *
 * This function is deliberately TOTAL: upstream rows are not trusted to match the
 * documented shape, and a single malformed row must never abort an otherwise valid
 * result set. Every field is therefore individually guarded.
 */
function mapResult(raw: TavilyResultRow | null | undefined): TavilySearchResultItem | null {
    if (!raw || typeof raw !== 'object') return null;

    const rawUrl = typeof raw.url === 'string' ? raw.url : null;
    if (!rawUrl) return null;

    const url = canonicaliseUrl(rawUrl);
    // Reject unusable, non-https, and pathologically long URLs. A URL we cannot
    // guarantee to be complete and working is worse than no URL at all.
    if (!url || url.length > TAVILY_URL_MAX_CHARS) return null;

    const rawTitle = typeof raw.title === 'string' ? raw.title : '';
    const rawContent = typeof raw.content === 'string' ? raw.content : '';

    return {
        title: rawTitle.replace(/\s+/g, ' ').trim().slice(0, 200),
        url,
        snippet: truncateSnippet(rawContent),
        score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0
    };
}

/**
 * Classifies an upstream failure from its error NAME only.
 *
 * The message and response body are deliberately never inspected or logged:
 * `@tavily/core` builds errors via `JSON.stringify(res.data)`, so the message can
 * echo arbitrary upstream text — including request context — straight into the
 * Pterodactyl console.
 */
function classifyFailure(err: unknown): TavilyUnavailableReason {
    const name = err instanceof Error ? err.name : '';
    if (name === 'ECONNABORTED' || name === 'ETIMEDOUT') return 'timeout';
    if (name === 'ERR_BAD_REQUEST' || name === 'ERR_BAD_RESPONSE') return 'auth';
    return 'network';
}

/**
 * Runs a Tavily search and returns a discriminated, budget-safe outcome.
 *
 * The deadline is enforced by `@tavily/core`'s own `timeout` option, which is
 * expressed in SECONDS and converted here. An `AbortController` is deliberately
 * NOT used: the SDK exposes no `signal` on `TavilySearchOptions` and calls
 * `axios.post` without one, so a controller would abort nothing while appearing
 * to provide a safety net.
 */
/**
 * Outcome of a page-content extraction for announcement use.
 *
 * Unlike search, extraction feeds a sender-controlled announcement body, so
 * only `ok`/`empty`/`unavailable` are distinguished — no snippets or URLs
 * ever reach the LLM context from here.
 */
export type WebPageExtractOutcome =
    | { kind: 'ok'; text: string }
    | { kind: 'empty' }
    | { kind: 'unavailable' };

/** Character ceiling on extracted page text before announcement use. */
export const EXTRACT_TEXT_MAX_CHARS = 4000;

const EXTRACT_TIMEOUT_SECONDS = Math.ceil(TAVILY_TIMEOUT_MS / SECONDS_PER_TIMEOUT_MS);

/**
 * Strips HTML down to plain text server-side (no new dependency).
 *
 * Removes script/style/noscript blocks first so embedded code never becomes
 * announcement text, then replaces tags with whitespace, decodes the common
 * entities, and collapses whitespace runs.
 */
export function stripHtmlToText(html: string): string {
    return (html ?? '')
        .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<(br|p|div|h[1-6]|li|tr|blockquote)[\s>]/gi, '\n<$1>')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&#(\d+);/g, (_m, digits: string) => {
            const code = Number(digits);
            return Number.isSafeInteger(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : ' ';
        })
        .replace(/[ \t\f\v\u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extracts readable page text for a URL via the Tavily Extract API (same key,
 * same timeout discipline as search), falling back to a plain server-side
 * fetch when Tavily is unconfigured or unreachable.
 *
 * The Tavily cloud fetches the target, never this host; the fallback reuses
 * the SSRF-safe raw-file fetcher. Only `http(s)` URLs are accepted.
 */
export async function extractWebPage(rawUrl: string): Promise<WebPageExtractOutcome> {
    const candidate = (rawUrl ?? '').trim();
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return { kind: 'unavailable' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'unavailable' };

    try {
        const apiKey = readApiKey();
        const client = tavily({ apiKey });
        const response = await client.extract([parsed.toString()], {
            extractDepth: 'basic',
            format: 'text',
            timeout: EXTRACT_TIMEOUT_SECONDS
        });
        const raw = response?.results?.find((row) => row && typeof row.rawContent === 'string')?.rawContent ?? '';
        const text = stripHtmlToText(raw).slice(0, EXTRACT_TEXT_MAX_CHARS).trim();
        return text ? { kind: 'ok', text } : { kind: 'empty' };
    } catch (err: unknown) {
        // Log the classification only — SDK errors can echo upstream text.
        console.error(`[TavilyClient] Extract unavailable (${err instanceof Error ? err.name : 'unknown'}), trying direct fetch.`);
    }

    try {
        const { fetchUrlText } = await import('../../commands/group/hideTag.js');
        const fetched = await fetchUrlText(parsed.toString());
        if (!fetched.ok) return { kind: 'unavailable' };
        const text = stripHtmlToText(fetched.text).slice(0, EXTRACT_TEXT_MAX_CHARS).trim();
        return text ? { kind: 'ok', text } : { kind: 'empty' };
    } catch (err: unknown) {
        console.error(`[TavilyClient] Extract fallback failed (${err instanceof Error ? err.name : 'unknown'}).`);
        return { kind: 'unavailable' };
    }
}

export async function searchWeb(params: TavilySearchParams): Promise<TavilyOutcome> {
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

    let response: TavilySearchResponse | undefined;
    try {
        response = await client.search(params.query, {
            ...options,
            // SECONDS, not milliseconds. See TAVILY_TIMEOUT_SECONDS.
            timeout: TAVILY_TIMEOUT_SECONDS
        });
    } catch (err: unknown) {
        const reason = classifyFailure(err);
        // Log the classification only. The upstream message/body is never emitted.
        console.error(`[TavilyClient] Search unavailable (reason: ${reason}).`);
        return { kind: 'unavailable', reason };
    }

    try {
        const rawResults = Array.isArray(response?.results) ? response.results : [];
        const mapped = rawResults.map(mapResult).filter((item): item is TavilySearchResultItem => item !== null);

        if (mapped.length === 0) return { kind: 'empty' };

        const resolvedQuery = typeof response?.query === 'string' ? response.query : params.query;
        return { kind: 'ok', output: reduceToBudget(mapped, resolvedQuery, mapped.length) };
    } catch (err: unknown) {
        // Defensive only: `mapResult` is already total, so this guards against a
        // future regression rather than a known path.
        console.error(`[TavilyClient] Result mapping failed (${err instanceof Error ? err.name : 'unknown'}).`);
        return { kind: 'unavailable', reason: 'network' };
    }
}
