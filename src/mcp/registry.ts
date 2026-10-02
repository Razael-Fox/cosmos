/**
 * Cosmos MCP Server — tool registration helpers.
 *
 * Centralises three invariants that must hold for every tool in the surface:
 *  1. Read-only mode compiles the entire mutating tool set OUT, rather than
 *     registering it and refusing at call time (issue #49 safety rails).
 *  2. Every mutating tool passes through the rate limiter and releases its
 *     concurrency slot, including on failure.
 *  3. Every failure is returned as a typed, machine-readable payload rather than
 *     a stack trace, and no credential ever appears in a result.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpRateLimiter } from './audit.js';
import type { McpIdentity } from './auth.js';
import { loadMcpConfig } from './config.js';
import { toToolError } from './errors.js';

export interface McpToolDeps {
    identity: McpIdentity;
}

type RawShape = Record<string, z.ZodTypeAny>;

export interface ToolRegistrationOptions {
    /** Formal English description shown to the coding agent (Rule H). */
    description: string;
    /** Zod raw shape describing the tool input. */
    inputSchema: RawShape;
    /** `true` for tools that change state or contact a user. */
    mutating?: boolean;
    handler: (args: Record<string, unknown>, deps: McpToolDeps) => Promise<unknown>;
}

export interface RegistrationSummary {
    registered: string[];
    /** Mutating tool names that were compiled out by read-only mode. */
    skippedByReadOnly: string[];
}

interface ToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    /** MCP permits additional top-level fields; keep the index signature open. */
    [key: string]: unknown;
}

function replacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

/** Serialises a payload to the MCP text-content shape. */
function toTextResult(payload: unknown): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(payload, replacer, 2) }] };
}

/**
 * Registers one tool, enforcing read-only compilation, rate limiting, and
 * typed error rendering.
 */
export function registerTool(
    server: McpServer,
    name: string,
    options: ToolRegistrationOptions,
    deps: McpToolDeps,
    summary: RegistrationSummary
): void {
    if (options.mutating && loadMcpConfig().readOnly) {
        summary.skippedByReadOnly.push(name);
        return;
    }

    const mutating = options.mutating === true;

    server.registerTool(
        name,
        {
            description: options.description,
            inputSchema: options.inputSchema,
            annotations: {
                readOnlyHint: !mutating,
                destructiveHint: mutating,
                idempotentHint: !mutating
            }
        },
        async (args: Record<string, unknown>) => {
            let slotHeld = false;
            try {
                mcpRateLimiter.assertAllowed(deps.identity, mutating);
                if (mutating) slotHeld = true;
                return toTextResult(await options.handler(args ?? {}, deps));
            } catch (err) {
                const toolError = toToolError(err);
                console.error(`[MCP] ${name} failed (${toolError.code}): ${toolError.message}`);
                return {
                    ...toTextResult({
                        error: toolError.code,
                        message: toolError.message,
                        ...(toolError.details ? { details: toolError.details } : {})
                    }),
                    isError: true
                };
            } finally {
                if (slotHeld) mcpRateLimiter.releaseMutationSlot();
            }
        }
    );

    summary.registered.push(name);
}

/** Shared zod primitives so every tool declares the same shapes. */
export const zod = {
    string: (description: string) => z.string().describe(description),
    optionalString: (description: string) => z.string().optional().describe(description),
    boolean: (description: string) => z.boolean().describe(description),
    optionalBoolean: (description: string) => z.boolean().optional().describe(description),
    int: (description: string) => z.number().int().describe(description),
    optionalInt: (description: string) => z.number().int().optional().describe(description),
    record: (description: string) => z.record(z.string(), z.unknown()).describe(description),
    optionalRecord: (description: string) => z.record(z.string(), z.unknown()).optional().describe(description),
    stringArray: (description: string) => z.array(z.string()).describe(description),
    optionalStringArray: (description: string) => z.array(z.string()).optional().describe(description),
    literal: <T extends string>(values: readonly T[], description: string) => z.enum(values).describe(description)
};

/** Per-tool registration entry point used by each tool module. */
export type ToolRegistrar = (server: McpServer, deps: McpToolDeps, summary: RegistrationSummary) => void;
