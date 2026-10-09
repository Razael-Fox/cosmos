import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { searchWeb, TavilyNotConfiguredError } from '../tavilyClient.js';
import { DecisionClient } from '../decisionClient.js';

/** Maximum accepted length of a caller-supplied search query. */
const QUERY_MAX_CHARS = 300;

/**
 * Web search tool for Sara AI (Tavily Search).
 *
 * Classified `READ_ONLY`: a search mutates no Cosmos state, so it executes
 * directly with no interactive confirmation staging.
 *
 * The result payload is deliberately structured and identifier-free so the Tier 2
 * executor can synthesize a cited answer in Sara's voice without ever seeing
 * caller PII. Every URL in the payload is already canonicalised by the client and
 * is guaranteed intact: a source appears with its complete working URL, or it is
 * not shown at all.
 */
export const webSearchTool: AgentTool = {
    name: 'web_search',
    description:
        'Searches the public web for current information, news, or reference facts. Use it whenever the answer depends on live data the assistant cannot know from memory: recent events, prices, schedules, scores, release notes, documentation, or "look this up" style requests. Returns ranked sources with titles, canonical URLs, and short snippets. The user asks about the present or the past; do not rely on memory for these.',
    policy: ToolAiPolicy.READ_ONLY,
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'The search query in plain natural language, extracted from the user request. Maximum 300 characters.'
            },
            max_results: {
                type: 'integer',
                description:
                    'How many sources to return. Between 1 and 10. Defaults to 5. Use a smaller number for quick factual lookups and a larger number for broader research.'
            },
            search_depth: {
                type: 'string',
                description:
                    'Search thoroughness. Send "advanced" only when the question needs multi-source synthesis. Omit this field entirely for ordinary lookups.'
            }
        },
        required: ['query']
    },

    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const rawQuery = typeof args.query === 'string' ? args.query.trim() : '';
        if (!rawQuery) {
            return { success: false, error: 'A search query is required.' };
        }
        if (rawQuery.length > QUERY_MAX_CHARS) {
            return { success: false, error: `The search query exceeds ${QUERY_MAX_CHARS} characters.` };
        }

        const maxResults = typeof args.max_results === 'number' ? args.max_results : undefined;

        // The schema deliberately omits an enum for `search_depth`: a strict enum
        // makes Groq reject the ENTIRE request when the model invents a value
        // (e.g. "short"), which discards an otherwise valid query. Unknown values
        // are coerced to "basic" here instead, so a guess never costs the user a
        // search.
        const searchDepth =
            typeof args.search_depth === 'string' && args.search_depth.trim().toLowerCase() === 'advanced'
                ? 'advanced'
                : 'basic';

        // Scrub phone numbers, raw JIDs, and currency values before the query
        // leaves this host. The query is free-form user text, and Tavily is a
        // third party; `executionLoop` also logs raw tool arguments, so this
        // sanitisation is the last point at which PII can be removed (Rule AB/AG).
        const safeQuery = DecisionClient.sanitizeUntrustedContent(rawQuery);
        if (!safeQuery) {
            return { success: false, error: 'The search query contained no searchable content.' };
        }

        try {
            const outcome = await searchWeb({
                query: safeQuery,
                maxResults,
                searchDepth
            });

            if (outcome.kind === 'unavailable') {
                console.error(`[WebSearch Tool] Upstream unavailable (reason: ${outcome.reason}).`);
                return { success: false, error: ctx.t('core.web_search_failed') };
            }

            if (outcome.kind === 'empty') {
                return {
                    success: true,
                    data: {
                        query: safeQuery,
                        resultCount: 0,
                        results: [],
                        notice: ctx.t('core.web_search_empty')
                    }
                };
            }

            const { output } = outcome;
            return {
                success: true,
                data: {
                    query: output.query,
                    resultCount: output.returnedResults,
                    totalFound: output.totalResults,
                    results: output.results,
                    notice: output.notice
                }
            };
        } catch (err: unknown) {
            if (err instanceof TavilyNotConfiguredError) {
                console.warn('[WebSearch Tool] Tavily is not configured (missing TAVILY_API_KEY).');
                return { success: false, error: ctx.t('core.web_search_unconfigured') };
            }
            // Classify by NAME only. The SDK embeds the upstream response body in
            // the error message, so the message must never reach the log.
            console.error(`[WebSearch Tool] Search failed (${err instanceof Error ? err.name : 'unknown'}).`);
            return { success: false, error: ctx.t('core.web_search_failed') };
        }
    }
};
