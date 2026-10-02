/**
 * Cosmos MCP Server — runtime configuration.
 *
 * Every knob is read from the process environment so nothing sensitive is ever
 * baked into the image, the repository, or a tool result (AGENTS.md Rule Y).
 *
 * Access model (single owner key, per issue #49):
 *  - The entire tool surface is gated behind exactly ONE API key held
 *    personally by the repository owner (`COSMOS_MCP_TOKEN`).
 *  - There is no per-user, per-agent, or per-workspace key, no self-service
 *    rotation, and no secondary credential.
 *  - When the key is missing or unconfigured the server fails closed.
 */

export interface McpRateLimitConfig {
    /** Maximum mutating tool invocations per identity within `windowMs`. */
    maxMutations: number;
    /** Maximum tool invocations (any kind) per identity within `windowMs`. */
    maxCalls: number;
    /** Sliding window length in milliseconds. */
    windowMs: number;
    /** Maximum simultaneously in-flight mutating tool invocations. */
    maxConcurrentMutations: number;
}

export interface McpConfig {
    /** Single owner API key. Empty string means "unconfigured" ⇒ fail closed. */
    token: string;
    /** Loopback interface the Streamable HTTP transport may bind to. */
    httpBindHost: string;
    /** Port for the Streamable HTTP transport. `0` disables the HTTP transport. */
    httpPort: number;
    /** Whether the Streamable HTTP transport is enabled at all. */
    httpEnabled: boolean;
    /** When true the entire mutating tool set is compiled out of the server. */
    readOnly: boolean;
    /** Database files may never be opened without a mandatory `LIMIT` clause. */
    defaultQueryLimit: number;
    /** Hard ceiling applied to any client-supplied `LIMIT`. */
    maxQueryLimit: number;
    /** Upper bound for `db_apply_mutation` bulk deletes. */
    maxBulkDeleteRows: number;
    /** Minimum accepted inter-group broadcast delay. */
    minBroadcastDelayMs: number;
    /** Maximum accepted inter-group broadcast delay. */
    maxBroadcastDelayMs: number;
    /** Hard ceiling on the number of targets a single broadcast may fan out to. */
    maxBroadcastTargets: number;
    /** Maximum length of an outbound operator message. */
    maxOutboundMessageLength: number;
    rateLimit: McpRateLimitConfig;
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

let cached: McpConfig | null = null;

export function loadMcpConfig(): McpConfig {
    if (cached) return cached;

    const httpPortRaw = process.env.COSMOS_MCP_HTTP_PORT;
    const httpPort =
        httpPortRaw === undefined || httpPortRaw.trim() === ''
            ? 4100
            : parseIntEnv('COSMOS_MCP_HTTP_PORT', 4100, 0, 65535);
    const httpEnabled = parseBoolEnv('COSMOS_MCP_HTTP_ENABLED', true);

    cached = {
        token: (process.env.COSMOS_MCP_TOKEN || '').trim(),
        // Rule V: loopback only. A non-loopback bind is refused at start-up.
        httpBindHost: (process.env.COSMOS_MCP_HTTP_BIND || '127.0.0.1').trim(),
        httpPort,
        httpEnabled: httpEnabled && httpPort > 0,
        readOnly: parseBoolEnv('COSMOS_MCP_READ_ONLY', false),
        defaultQueryLimit: parseIntEnv('COSMOS_MCP_DEFAULT_QUERY_LIMIT', 200, 1, 1000),
        maxQueryLimit: parseIntEnv('COSMOS_MCP_MAX_QUERY_LIMIT', 1000, 1, 10000),
        maxBulkDeleteRows: parseIntEnv('COSMOS_MCP_MAX_BULK_DELETE_ROWS', 50, 1, 100000),
        minBroadcastDelayMs: parseIntEnv('COSMOS_MCP_MIN_BROADCAST_DELAY_MS', 1000, 0, 86_400_000),
        maxBroadcastDelayMs: parseIntEnv('COSMOS_MCP_MAX_BROADCAST_DELAY_MS', 3_600_000, 1000, 86_400_000),
        maxBroadcastTargets: parseIntEnv('COSMOS_MCP_MAX_BROADCAST_TARGETS', 5000, 1, 1_000_000),
        maxOutboundMessageLength: parseIntEnv('COSMOS_MCP_MAX_MESSAGE_LENGTH', 4096, 16, 65_536),
        rateLimit: {
            maxMutations: parseIntEnv('COSMOS_MCP_MAX_MUTATIONS', 60, 1, 100_000),
            maxCalls: parseIntEnv('COSMOS_MCP_MAX_CALLS', 600, 1, 1_000_000),
            windowMs: parseIntEnv('COSMOS_MCP_RATE_WINDOW_MS', 60_000, 1000, 3_600_000),
            maxConcurrentMutations: parseIntEnv('COSMOS_MCP_MAX_CONCURRENT_MUTATIONS', 2, 1, 64)
        }
    };
    return cached;
}

/** Test seam: forces the next {@link loadMcpConfig} call to re-read the environment. */
export function resetMcpConfigCache(): void {
    cached = null;
}

/**
 * Returns true when a single owner key is configured. Callers must refuse to
 * serve any request when this is false — never degrade to anonymous access.
 */
export function isOwnerKeyConfigured(): boolean {
    return loadMcpConfig().token.length > 0;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Rule V guard: the HTTP transport must never be bound to a routable address. */
export function isLoopbackBind(host: string): boolean {
    return LOOPBACK_HOSTS.has(host);
}
