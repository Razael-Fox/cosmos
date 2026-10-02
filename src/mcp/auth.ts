/**
 * Cosmos MCP Server — single-owner API key authentication.
 *
 * Design (issue #49, "Single-Owner API Key"):
 *  - Exactly ONE key authenticates the whole MCP surface. It is provisioned
 *    out-of-band and lives only in the environment (Doppler / container `.env`).
 *  - Only the repository owner can reset or rotate it. There is no second key,
 *    no per-client key, no self-service rotation, and no recovery backdoor.
 *  - The server FAILS CLOSED. A missing, empty, or mismatched key always
 *    yields `401 UNAUTHORIZED_MCP`; there is no anonymous, default, development,
 *    or loopback-bypass path.
 *  - Comparison is constant time and the key is never echoed anywhere: not in a
 *    tool response, not in an error, not in a Pterodactyl-visible log line.
 */
import crypto from 'crypto';
import { timingSafeStringCompare } from '#services/otpService.js';
import { isOwnerKeyConfigured, loadMcpConfig } from './config.js';
import { McpToolError } from './errors.js';

/** The single audited identity recorded for every mutating tool invocation. */
export const OWNER_IDENTITY = 'repository-owner';

export interface McpIdentity {
    /** Stable actor label written to the audit trail. Never a credential. */
    identity: string;
    /** Non-secret fingerprint used only for rate-limit bucketing. */
    fingerprint: string;
    /** Transport the caller arrived on. */
    transport: 'stdio' | 'http';
}

/**
 * Derives a non-reversible, non-secret fingerprint of the presented key so the
 * rate limiter can bucket callers without ever storing the credential itself.
 */
export function fingerprintKey(key: string): string {
    // A truncated SHA-256 digest is one-way and carries no recoverable entropy.
    return crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Validates a presented owner key.
 *
 * @throws {McpToolError} `UNAUTHORIZED_MCP` when the server has no configured
 * key or the presented key does not match. Never falls back to a default key.
 */
export function authenticateOwnerKey(
    presented: string | undefined | null,
    transport: McpIdentity['transport']
): McpIdentity {
    const expected = loadMcpConfig().token;

    // Fail closed: an unconfigured server authenticates nobody.
    if (!isOwnerKeyConfigured() || expected.length === 0) {
        throw new McpToolError(
            'UNAUTHORIZED_MCP',
            'The Cosmos MCP server has no owner API key configured. Set COSMOS_MCP_TOKEN and restart the server.'
        );
    }

    const provided = typeof presented === 'string' ? presented.trim() : '';
    if (provided.length === 0 || !timingSafeStringCompare(provided, expected)) {
        // Intentionally logs neither the presented nor the expected value.
        console.warn('[MCP] Rejected an unauthenticated request on the %s transport.', transport);
        throw new McpToolError(
            'UNAUTHORIZED_MCP',
            'A valid Cosmos MCP owner API key is required. Rotate the key in the secret manager if it was lost.'
        );
    }

    return { identity: OWNER_IDENTITY, fingerprint: fingerprintKey(provided), transport };
}

/**
 * Extracts the owner key from an HTTP request. Supports the `x-internal-secret`
 * header (the header already used by `.worktrees/api/src/routes/internal.ts`) and
 * an `Authorization: Bearer` fallback.
 */
export function extractTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string {
    const header = headers['x-internal-secret'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();

    const authorization = headers.authorization;
    const rawAuth = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof rawAuth === 'string' && rawAuth.toLowerCase().startsWith('bearer ')) {
        return rawAuth.slice(7).trim();
    }
    return '';
}
