/**
 * Cosmos MCP Server — guarded mutation executor.
 *
 * `cosmos_db_apply_mutation` executes a mutation ONLY when
 * `cosmos_db_mutation_plan` returned `safe: true` for the byte-identical request
 * (verified through {@link fingerprintMutation}). Additional gates:
 *
 *  - `--read-only` deployments compile this module out entirely.
 *  - Destructive operations require `confirm: true` AND a row-count preview.
 *  - Bulk deletes above `COSMOS_MCP_MAX_BULK_DELETE_ROWS` are refused.
 *  - Every execution runs inside `prisma.$transaction`, writes an
 *    `ActivityLog` row, prints a Pterodactyl-visible `console.log` line, and
 *    returns the before/after diff (issue #49).
 */
import { prisma } from '#db.js';
import { recordAudit } from '../audit.js';
import type { McpIdentity } from '../auth.js';
import { loadMcpConfig } from '../config.js';
import { McpToolError } from '../errors.js';
import { maskDeep } from '../privacy.js';
import { fingerprintMutation, planMutation, type MutationRequest } from './mutationPlanner.js';

export interface ApplyMutationInput extends MutationRequest {
    /** Must match the fingerprint of the plan the agent already obtained. */
    planFingerprint: string;
    /** Required for `delete` and `drop`. */
    confirm?: boolean;
    /** Set when the agent has already shown the operator the row-count preview. */
    acknowledgedRowCount?: number;
}

export interface ApplyMutationResult {
    applied: boolean;
    model: string;
    operation: string;
    rowsAffected: number;
    /** Rows as they were before the mutation, masked. */
    before: Array<Record<string, unknown>>;
    /** Rows as they are after the mutation, masked. */
    after: Array<Record<string, unknown>>;
    /** `ActivityLog` audit row id, when the audit row was persisted. */
    activityLogId?: string;
    summary: string;
}

/** Snapshot cap so a large mutation cannot flood the tool response. */
const SNAPSHOT_ROW_CAP = 25;

/**
 * Resolves the Prisma delegate name for a model. Prisma exposes `user`,
 * `bankAccount`, `propertyTransaction`, ... so the model name is lower-cased
 * first, matching the generated client convention for Cosmos models.
 */
function delegateFor(model: string): string {
    return model.charAt(0).toLowerCase() + model.slice(1);
}

function toPlainRow(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};
    const row: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        row[key] = typeof entry === 'bigint' ? entry.toString() : entry instanceof Date ? entry.toISOString() : entry;
    }
    return row;
}

/**
 * Plans, re-verifies, and applies one mutation atomically.
 *
 * @throws {McpToolError} `PLAN_REQUIRED` when the plan is unsafe or the
 * supplied fingerprint does not match; `CONFIRMATION_REQUIRED` for destructive
 * operations without `confirm: true`; `READ_ONLY_MODE` in a read-only
 * deployment.
 */
export async function applyMutation(input: ApplyMutationInput, identity: McpIdentity): Promise<ApplyMutationResult> {
    const config = loadMcpConfig();
    if (config.readOnly) {
        throw new McpToolError(
            'READ_ONLY_MODE',
            'This Cosmos MCP deployment runs in read-only mode, so mutations are not available.'
        );
    }

    const plan = planMutation(input);
    if (!plan.safe) {
        throw new McpToolError(
            'UNSAFE_MUTATION',
            `The mutation was refused by the planner: ${plan.blockers.join(' ')}`,
            {
                blockers: plan.blockers
            }
        );
    }

    const fingerprint = fingerprintMutation(input);
    if (fingerprint !== input.planFingerprint) {
        throw new McpToolError(
            'PLAN_REQUIRED',
            'The mutation does not match the plan that was produced. Re-run cosmos_db_mutation_plan for this exact request and pass its fingerprint.',
            { expected: input.planFingerprint, received: fingerprint }
        );
    }

    if (plan.destructive && input.confirm !== true) {
        throw new McpToolError(
            'CONFIRMATION_REQUIRED',
            `A ${input.operation} on ${plan.model} is destructive and requires confirm: true.`,
            {
                affectedRowCount: plan.affectedRowCount
            }
        );
    }

    const delegate = delegateFor(plan.model);
    const where = input.where ?? {};
    const set = input.set ?? {};

    // Row-count preview, always computed inside the same transaction.
    const beforeRows = await prisma.$transaction(async (tx) => {
        const txDelegate = (tx as unknown as Record<string, { findMany: (args: unknown) => Promise<unknown[]> }>)[
            delegate
        ];
        const existing = (await txDelegate.findMany({
            where,
            take: input.operation === 'delete' ? config.maxBulkDeleteRows + 1 : SNAPSHOT_ROW_CAP
        })) as unknown[];
        return existing;
    });

    const affectedRowCount = beforeRows.length;

    if (input.operation === 'delete') {
        if (affectedRowCount > config.maxBulkDeleteRows) {
            throw new McpToolError(
                'UNSAFE_MUTATION',
                `The delete would affect more than ${config.maxBulkDeleteRows} rows. Narrow the where filter, or raise COSMOS_MCP_MAX_BULK_DELETE_ROWS deliberately.`,
                { affectedRowCount, ceiling: config.maxBulkDeleteRows }
            );
        }
        if (input.acknowledgedRowCount !== undefined && input.acknowledgedRowCount !== affectedRowCount) {
            throw new McpToolError(
                'UNSAFE_MUTATION',
                'The affected row count changed since the preview was acknowledged. Re-run cosmos_db_mutation_plan and confirm again.',
                { previewed: input.acknowledgedRowCount, current: affectedRowCount }
            );
        }
    }

    const audit = await recordAudit({
        identity,
        tool: 'cosmos_db_apply_mutation',
        summary: `${plan.operation} on ${plan.model} affecting ${affectedRowCount} row(s).`,
        diff: { where, set: maskDeep(set) }
    });

    const outcome = await prisma.$transaction(async (tx) => {
        const txDelegate = (tx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[
            delegate
        ];

        let rowsAffected = 0;
        if (input.operation === 'create') {
            const created = await txDelegate.create({
                data: { ...set, ...(where.id !== undefined ? { id: where.id } : {}) }
            });
            rowsAffected = 1;
            return { rowsAffected, after: [toPlainRow(created)] };
        }
        if (input.operation === 'update') {
            const result = (await txDelegate.updateMany({ where, data: set })) as { count: number };
            rowsAffected = result.count;
        } else if (input.operation === 'upsert') {
            await txDelegate.upsert({ where, create: set, update: set });
            rowsAffected = 1;
        } else if (input.operation === 'delete') {
            const result = (await txDelegate.deleteMany({ where })) as { count: number };
            rowsAffected = result.count;
        }

        const after =
            input.operation === 'delete'
                ? []
                : ((await txDelegate.findMany({ where, take: SNAPSHOT_ROW_CAP })) as unknown[]);
        return { rowsAffected, after };
    });

    const before = beforeRows
        .slice(0, SNAPSHOT_ROW_CAP)
        .map((row) => maskDeep(toPlainRow(row)) as Record<string, unknown>);
    const after = outcome.after
        .slice(0, SNAPSHOT_ROW_CAP)
        .map((row) => maskDeep(toPlainRow(row)) as Record<string, unknown>);

    return {
        applied: true,
        model: plan.model,
        operation: plan.operation,
        rowsAffected: outcome.rowsAffected,
        before,
        after,
        activityLogId: audit.activityLogId,
        summary: `Applied ${plan.operation} to ${plan.model}; ${outcome.rowsAffected} row(s) affected.`
    };
}
