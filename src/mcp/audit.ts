/**
 * Cosmos MCP Server — audit trail and rate limiting.
 *
 * Every mutating tool invocation:
 *  1. prints a Pterodactyl-visible `console.log` line (AGENTS.md Rule C), and
 *  2. persists an `ActivityLog` row recording the ACTING IDENTITY, the tool
 *     name, and the before/after diff.
 *
 * The audit trail records the holder, never the credential, so it survives an
 * owner-side key rotation intact (issue #49, "Audit the holder, not the key").
 */
import { prisma } from '#db.js';
import { getOwnerNumbers } from '#utils/owner.js';
import type { McpIdentity } from './auth.js';
import { loadMcpConfig } from './config.js';
import { McpToolError } from './errors.js';
import { maskDeep } from './privacy.js';

/** `ActivityLog.type` values used by the MCP subsystem. */
export const MCP_ACTIVITY_TYPE = 'MCP_MUTATION';

/** Per-identity sliding-window rate limiter plus a mutation concurrency gate. */
class RateLimiter {
    private calls = new Map<string, number[]>();
    private mutations = new Map<string, number[]>();
    private inFlightMutations = 0;

    private prune(bucket: Map<string, number[]>, fingerprint: string, windowMs: number): number[] {
        const cutoff = Date.now() - windowMs;
        const hits = (bucket.get(fingerprint) || []).filter((ts) => ts > cutoff);
        bucket.set(fingerprint, hits);
        return hits;
    }

    assertAllowed(identity: McpIdentity, mutating: boolean): void {
        const { rateLimit } = loadMcpConfig();
        const calls = this.prune(this.calls, identity.fingerprint, rateLimit.windowMs);
        if (calls.length >= rateLimit.maxCalls) {
            throw new McpToolError(
                'RATE_LIMITED',
                `Too many Cosmos MCP calls. At most ${rateLimit.maxCalls} calls are permitted per ${rateLimit.windowMs} ms.`,
                { scope: 'calls', limit: rateLimit.maxCalls, windowMs: rateLimit.windowMs }
            );
        }
        calls.push(Date.now());

        if (!mutating) return;

        const mutations = this.prune(this.mutations, identity.fingerprint, rateLimit.windowMs);
        if (mutations.length >= rateLimit.maxMutations) {
            throw new McpToolError(
                'RATE_LIMITED',
                `Too many Cosmos MCP mutating calls. At most ${rateLimit.maxMutations} mutations are permitted per ${rateLimit.windowMs} ms.`,
                { scope: 'mutations', limit: rateLimit.maxMutations, windowMs: rateLimit.windowMs }
            );
        }
        mutations.push(Date.now());

        if (this.inFlightMutations >= rateLimit.maxConcurrentMutations) {
            throw new McpToolError(
                'RATE_LIMITED',
                `Too many Cosmos MCP mutations are already running. At most ${rateLimit.maxConcurrentMutations} may execute concurrently.`,
                { scope: 'concurrency', limit: rateLimit.maxConcurrentMutations }
            );
        }

        // Acquire the concurrency slot; the caller MUST release it via
        // {@link RateLimiter.releaseMutationSlot} once the mutation settles.
        this.inFlightMutations += 1;
    }

    /** Releases a concurrency slot previously acquired by {@link assertAllowed}. */
    releaseMutationSlot(): void {
        if (this.inFlightMutations > 0) this.inFlightMutations -= 1;
    }

    /** Test seam. */
    reset(): void {
        this.calls.clear();
        this.mutations.clear();
        this.inFlightMutations = 0;
    }
}

export const mcpRateLimiter = new RateLimiter();

let resolvedAuditUserId: string | null | undefined;

/**
 * Resolves the `ActivityLog.userId` the MCP audit trail attaches to.
 *
 * `ActivityLog.userId` is a foreign key onto `User.id`, so the owner identity
 * has to be mapped onto a real user row. `COSMOS_MCP_AUDIT_USER_JID` wins, then
 * the first configured owner number. When neither resolves, audit rows are
 * skipped (the console line is still emitted) rather than fabricating a row.
 */
export async function resolveAuditUserId(): Promise<string | null> {
    if (resolvedAuditUserId !== undefined) return resolvedAuditUserId;

    const explicit = (process.env.COSMOS_MCP_AUDIT_USER_JID || '').trim();
    if (explicit) {
        resolvedAuditUserId = explicit;
        return resolvedAuditUserId;
    }

    const ownerNumber = getOwnerNumbers()[0] || null;
    if (!ownerNumber) {
        resolvedAuditUserId = null;
        return null;
    }

    try {
        const match = await prisma.user.findFirst({
            where: {
                OR: [{ id: ownerNumber }, { id: `${ownerNumber}@s.whatsapp.net` }, { id: { contains: ownerNumber } }]
            },
            select: { id: true }
        });
        resolvedAuditUserId = match?.id ?? null;
    } catch (err) {
        console.error('[MCP] Failed to resolve the audit owner user row:', err);
        resolvedAuditUserId = null;
    }
    return resolvedAuditUserId;
}

/** Test seam: forces the audit owner lookup to run again. */
export function resetAuditUserIdCache(): void {
    resolvedAuditUserId = undefined;
}

export interface AuditRecordInput {
    identity: McpIdentity;
    /** MCP tool name, e.g. `cosmos_db_apply_mutation`. */
    tool: string;
    /** Formal English summary written to the console and the audit trail. */
    summary: string;
    /** Structured before/after diff. Masked before persistence. */
    diff?: Record<string, unknown>;
    /** Optional amount for ledgers; omitted for non-financial operations. */
    amount?: bigint | number | null;
    /**
     * `ActivityLog.userId` target. Defaults to the owner identity label so an
     * agent-initiated audit row is always attached to a real user row when the
     * owner identity maps onto one; pass `null` to skip persistence entirely.
     */
    userId?: string | null;
}

export interface AuditRecord {
    /** Whether the `ActivityLog` row was written. */
    persisted: boolean;
    /** The created row id, when persistence succeeded. */
    activityLogId?: string;
}

/**
 * Prints a Pterodactyl-visible audit line and persists an `ActivityLog` row.
 * Never throws: an audit failure must not abort the operation the agent asked
 * for, but it is always reported loudly on the console.
 */
export async function recordAudit(input: AuditRecordInput): Promise<AuditRecord> {
    const diff = input.diff ? (maskDeep(input.diff) as Record<string, unknown>) : undefined;
    const diffJson = diff ? JSON.stringify(diff).slice(0, 4000) : null;

    console.log(
        `[MCP] ${input.tool} by ${input.identity.identity} via ${input.identity.transport}: ${input.summary}` +
            (diffJson ? ` | diff=${diffJson}` : '')
    );

    const userId = input.userId === undefined ? await resolveAuditUserId() : input.userId;
    if (!userId) {
        console.warn(
            '[MCP] Audit row skipped: no ActivityLog.userId could be resolved. Set COSMOS_MCP_AUDIT_USER_JID or OWNER_PHONE_NUMBER.'
        );
        return { persisted: false };
    }

    try {
        const row = await prisma.activityLog.create({
            data: {
                userId,
                type: MCP_ACTIVITY_TYPE,
                amount: input.amount === undefined || input.amount === null ? null : BigInt(input.amount),
                description: `${input.tool}: ${input.summary}${diffJson ? ` | ${diffJson}` : ''}`.slice(0, 4000)
            },
            select: { id: true }
        });
        return { persisted: true, activityLogId: row.id };
    } catch (err) {
        console.error('[MCP] Failed to persist the ActivityLog audit row:', err);
        return { persisted: false };
    }
}
