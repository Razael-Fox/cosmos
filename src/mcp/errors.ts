/**
 * Cosmos MCP Server — typed tool errors.
 *
 * Every failure surfaced to a coding agent carries a stable machine-readable
 * code plus a Formal English message (AGENTS.md Rule H). Codes are part of the
 * public contract documented in `docs/COSMOS_MCP.md`.
 */

export type McpErrorCode =
    | 'UNAUTHORIZED_MCP'
    | 'FORBIDDEN_TABLE'
    | 'FORBIDDEN_SQL'
    | 'FORBIDDEN_COLUMN'
    | 'UNKNOWN_MODEL'
    | 'UNKNOWN_FIELD'
    | 'MISSING_WHERE_CLAUSE'
    | 'INVALID_SQL'
    | 'UNSAFE_MUTATION'
    | 'PLAN_REQUIRED'
    | 'CONFIRMATION_REQUIRED'
    | 'READ_ONLY_MODE'
    | 'RATE_LIMITED'
    | 'BOT_OFFLINE'
    | 'INVALID_PAYLOAD'
    | 'NOT_FOUND'
    | 'INTERNAL_ERROR';

export class McpToolError extends Error {
    readonly code: McpErrorCode;
    readonly details?: Record<string, unknown>;

    constructor(code: McpErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'McpToolError';
        this.code = code;
        this.details = details;
    }

    toJSON(): { error: McpErrorCode; message: string; details?: Record<string, unknown> } {
        return { error: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
    }
}

/** Narrow an unknown thrown value into an {@link McpToolError}. */
export function toToolError(err: unknown): McpToolError {
    if (err instanceof McpToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new McpToolError('INTERNAL_ERROR', message);
}
