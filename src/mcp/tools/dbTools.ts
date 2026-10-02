/**
 * Cosmos MCP Server — `cosmos_db_*` tool group.
 *
 * Database access for coding agents. Every tool is schema-aware: nothing here
 * lets an agent invent a column, bypass the ACID rules, or open the SQLite file
 * directly (issue #49, "The agent prompt / contract").
 */
import { prisma } from '#db.js';
import { describeDatabase, extractProjection, runAggregate, runCount, runGuardedSelect } from '../sql/readOnlyDb.js';
import { DENYLISTED_TABLES, WHERE_REQUIRED_TABLES } from '../sql/guardrails.js';
import { findModel, loadSchemaCatalogue, type SchemaModel } from '../schema/prismaCatalog.js';
import { runSchemaChecks } from '../schema/ddlMirror.js';
import { fingerprintMutation, planMutation, type MutationOperation } from '../schema/mutationPlanner.js';
import { applyMutation } from '../schema/applyMutation.js';
import { computeFileHash, readLastBackupHash, runBackupCycle } from '#utils/backup.js';
import { resolveStatusDatabasePath } from '#services/statusNotifier/dbPath.js';
import fs from 'fs';
import { McpToolError } from '../errors.js';
import { loadMcpConfig } from '../config.js';
import { registerTool, zod, type ToolRegistrar } from '../registry.js';
import { getVersionInfo } from '#utils/versioning.js';

function summariseModel(model: SchemaModel): Record<string, unknown> {
    return {
        name: model.name,
        compositeId: model.compositeId,
        uniqueGroups: model.uniqueGroups,
        indexes: model.indexes,
        enums: model.enums,
        fields: model.fields.map((field) => ({
            name: field.name,
            type: field.type,
            isList: field.isList,
            isOptional: field.isOptional,
            isId: field.isId,
            isUnique: field.isUnique,
            default: field.default,
            relationTo: field.relationTo,
            isUpdatedAt: field.isUpdatedAt
        }))
    };
}

export const registerDbTools: ToolRegistrar = (server, deps, summary) => {
    registerTool(
        server,
        'cosmos_db_describe',
        {
            description:
                'Return the LIVE Cosmos database catalogue parsed from prisma/schema.prisma: every model, field, type, default, index, and relation. Call this before any query or mutation so you never reference a column that does not exist. Optionally narrow the result to a single model.',
            inputSchema: {
                model: zod.optionalString('Return only this model. Omit for the full catalogue.')
            },
            handler: async (args) => {
                const catalogue = loadSchemaCatalogue();
                if (!catalogue) {
                    throw new McpToolError(
                        'NOT_FOUND',
                        'prisma/schema.prisma could not be located in this deployment.'
                    );
                }

                const requested = args.model as string | undefined;
                if (requested) {
                    const model = findModel(catalogue, requested);
                    if (!model) {
                        throw new McpToolError('UNKNOWN_MODEL', `The model ${requested} does not exist.`, {
                            availableModels: catalogue.models.map((entry) => entry.name)
                        });
                    }
                    return { model: summariseModel(model) };
                }

                return {
                    generator: catalogue.generator,
                    datasource: catalogue.datasource,
                    modelCount: catalogue.modelCount,
                    models: catalogue.models.map(summariseModel),
                    accessPolicy: {
                        credentialTablesRefused: Object.keys(DENYLISTED_TABLES),
                        whereClauseMandatoryFor: [...WHERE_REQUIRED_TABLES]
                    }
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_query',
        {
            description:
                'Run a single parameterised, read-only SELECT against the Cosmos SQLite database. A LIMIT clause is mandatory, an explicit column projection is mandatory, credential tables are refused outright, and high-value tables require a WHERE clause.',
            inputSchema: {
                sql: zod.string(
                    'A single read-only SELECT statement including its own LIMIT clause. Use ? placeholders for values.'
                ),
                params: zod.optionalRecord('Bound parameters referenced by the ? placeholders in the statement.'),
                columns: zod.optionalStringArray(
                    'The projected column names, used for the credential-column guardrail. Defaults to the projection parsed from the statement.'
                ),
                limit: zod.optionalInt('Optional explicit row ceiling. The value is clamped to the configured maximum.')
            },
            handler: async (args) => {
                const sql = String(args.sql ?? '');
                const params = (args.params ?? {}) as Record<string, unknown>;
                const limit = args.limit as number | undefined;

                // Positional `?` placeholders read from the ordered value list.
                const ordered = Array.isArray(params) ? (params as unknown[]) : Object.values(params);

                const result = runGuardedSelect({
                    sql,
                    params: ordered,
                    limit,
                    columns: (args.columns as string[] | undefined) ?? extractProjection(sql)
                });

                return {
                    columns: result.columns,
                    rowCount: result.rowCount,
                    limit: result.limit,
                    rows: result.rows,
                    note: 'Contact identifiers are masked. Use contact_ref aliases with cosmos_bot_send_message to address a specific chat.'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_count',
        {
            description:
                'Count rows in a table with an optional WHERE clause, applying the same guardrails as cosmos_db_query.',
            inputSchema: {
                table: zod.string('The exact model / table name, for example BankAccount.'),
                where: zod.optionalString(
                    'An optional SQL boolean expression, for example "status = \'FROZEN\'". Use ? placeholders for values.'
                ),
                params: zod.optionalRecord('Bound parameters referenced by the ? placeholders.')
            },
            handler: async (args) => {
                const params = (args.params ?? {}) as Record<string, unknown>;
                const ordered = Array.isArray(params) ? (params as unknown[]) : Object.values(params);
                return runCount({
                    table: String(args.table ?? ''),
                    where: args.where as string | undefined,
                    params: ordered
                });
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_aggregate',
        {
            description:
                'Compute a SUM, AVG, MIN, or MAX over a single numeric column, optionally grouped by another column, so you never hand-roll aggregation SQL.',
            inputSchema: {
                table: zod.string('The exact model / table name.'),
                column: zod.string('The numeric column to aggregate.'),
                aggregate: zod.literal(['sum', 'avg', 'min', 'max'] as const, 'The aggregation function to apply.'),
                groupBy: zod.optionalString('An optional column to group by.'),
                where: zod.optionalString('An optional SQL boolean expression. Use ? placeholders for values.'),
                params: zod.optionalRecord('Bound parameters referenced by the ? placeholders.'),
                limit: zod.optionalInt('Maximum number of groups to return.')
            },
            handler: async (args) => {
                const params = (args.params ?? {}) as Record<string, unknown>;
                const ordered = Array.isArray(params) ? (params as unknown[]) : Object.values(params);
                return runAggregate({
                    table: String(args.table ?? ''),
                    column: String(args.column ?? ''),
                    aggregate: args.aggregate as 'sum' | 'avg' | 'min' | 'max',
                    groupBy: args.groupBy as string | undefined,
                    where: args.where as string | undefined,
                    params: ordered,
                    limit: args.limit as number | undefined
                });
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_mutation_plan',
        {
            description:
                'Dry-run planner for an intended Cosmos database mutation. Writes nothing. Reports whether the change is safe to apply, the exact prisma.$transaction boilerplate Cosmos requires, whether the Rule W 3-phase DDL must be applied in BOTH src/db.ts and .worktrees/api/src/db.ts, whether the change touches an ACID-guarded domain needing balanceAfter plus an ActivityLog entry, and the i18n / schema-mirror checklist. Pass the returned planFingerprint to cosmos_db_apply_mutation.',
            inputSchema: {
                model: zod.string('The Prisma model name, for example BankAccount.'),
                operation: zod.literal(
                    ['create', 'update', 'upsert', 'delete', 'drop'] as const,
                    'The intended mutation operation.'
                ),
                set: zod.optionalRecord('Column assignments for create, update, or upsert.'),
                where: zod.optionalRecord(
                    'Equality filters identifying the affected rows. Mandatory for update, upsert, and delete.'
                ),
                columns: zod.optionalStringArray('Optional explicit column list for a create operation.')
            },
            handler: async (args) => {
                const plan = planMutation({
                    model: String(args.model ?? ''),
                    operation: args.operation as MutationOperation,
                    set: (args.set ?? {}) as Record<string, unknown>,
                    where: (args.where ?? {}) as Record<string, unknown>,
                    columns: args.columns as string[] | undefined
                });
                return {
                    ...plan,
                    planFingerprint: fingerprintMutation({
                        model: plan.model,
                        operation: plan.operation,
                        set: args.set as Record<string, unknown>,
                        where: args.where as Record<string, unknown>
                    })
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_apply_mutation',
        {
            description:
                'Apply a Cosmos database mutation. Executes ONLY when cosmos_db_mutation_plan returned safe: true for the byte-identical request; pass that planFingerprint. Wrapped in prisma.$transaction, audited to ActivityLog, printed to the console, and returns the before/after diff. Destructive operations require confirm: true and a row-count preview.',
            mutating: true,
            inputSchema: {
                model: zod.string('The Prisma model name.'),
                operation: zod.literal(
                    ['create', 'update', 'upsert', 'delete'] as const,
                    'The mutation operation to execute.'
                ),
                set: zod.optionalRecord('Column assignments for create, update, or upsert.'),
                where: zod.optionalRecord('Equality filters identifying the affected rows.'),
                planFingerprint: zod.string(
                    'The planFingerprint returned by cosmos_db_mutation_plan for this exact request.'
                ),
                confirm: zod.optionalBoolean('Required: true for a destructive operation.'),
                acknowledgedRowCount: zod.optionalInt('The affected row count the agent acknowledged in its preview.')
            },
            handler: async (args, toolDeps) =>
                applyMutation(
                    {
                        model: String(args.model ?? ''),
                        operation: args.operation as MutationOperation,
                        set: (args.set ?? {}) as Record<string, unknown>,
                        where: (args.where ?? {}) as Record<string, unknown>,
                        planFingerprint: String(args.planFingerprint ?? ''),
                        confirm: args.confirm as boolean | undefined,
                        acknowledgedRowCount: args.acknowledgedRowCount as number | undefined
                    },
                    toolDeps.identity
                )
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_backup',
        {
            description:
                'Trigger the existing Cosmos database snapshot pipeline (src/utils/backup.ts) and report the snapshot hash and destination summary. Reports the truthful outcome; it never claims a snapshot exists when none was persisted.',
            mutating: true,
            inputSchema: {
                force: zod.optionalBoolean(
                    'Force a snapshot even when the database is unchanged since the last backup.'
                )
            },
            handler: async (args) => {
                const dbPath = resolveStatusDatabasePath();
                const before = readLastBackupHash();
                const uploaded = await runBackupCycle({ force: args.force === true });
                const exists = fs.existsSync(dbPath);
                const currentHash = exists ? await computeFileHash(dbPath) : null;
                return {
                    database: dbPath,
                    exists,
                    uploadedToTelegram: uploaded,
                    previousBackupHash: before,
                    currentHash,
                    changed: Boolean(before && currentHash && before !== currentHash),
                    note: 'Restores are never automatic. Use cosmos_db_restore_plan for a reviewed procedure.'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_restore_plan',
        {
            description:
                'Produce a reviewed, plan-only restore procedure for the Cosmos SQLite database, including available snapshot hashes. Never executes a restore and never deletes anything.',
            inputSchema: {
                snapshotPath: zod.optionalString('An optional snapshot file to validate and describe.')
            },
            handler: async (args) => {
                const dbPath = resolveStatusDatabasePath();
                const snapshotPath = args.snapshotPath as string | undefined;
                const steps = [
                    'Stop the cosmos-bot, cosmos-api, and cosmos-mcp PM2 services so no writer holds the database file.',
                    'Copy the current database aside: cp <database> <database>.pre-restore.',
                    'Replace the database file with the selected snapshot.',
                    'Restart the services; the programmatic DDL bootstrap in src/db.ts applies any missing columns and indexes.',
                    'Verify with cosmos_db_migration_status and cosmos_db_describe.'
                ];
                return {
                    executable: false,
                    reason: 'Restores are never executed automatically and always require an explicit operator action outside the MCP surface.',
                    database: dbPath,
                    snapshotPath: snapshotPath ?? null,
                    snapshotExists: snapshotPath ? fs.existsSync(snapshotPath) : false,
                    lastBackupHash: readLastBackupHash(),
                    steps,
                    warnings: [
                        'Restoring rolls back every ledger written after the snapshot, including bank and loan records.',
                        'Rule W: after a restore, confirm both DDL drivers still declare the same table set with cosmos_schema_check.'
                    ]
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_migration_status',
        {
            description:
                'Report the live database migration posture: whether prisma/schema.prisma and both better-sqlite3 DDL drivers agree, which models are missing from each driver, and the pending Rule W 3-phase work. Never runs prisma migrate; it only reports.',
            inputSchema: {},
            handler: async () => {
                const checks = runSchemaChecks();
                const config = loadMcpConfig();
                const database = describeDatabase();
                const modelCount = checks.schemaPrisma.modelCount;
                return {
                    database,
                    schemaPrisma: checks.schemaPrisma,
                    driversComparable: checks.driversComparable,
                    mirrorSymmetric: checks.mirrorSymmetric,
                    migrationOrderValid: checks.migrationOrderValid,
                    findings: checks.findings,
                    guardrails: {
                        defaultQueryLimit: config.defaultQueryLimit,
                        maxQueryLimit: config.maxQueryLimit,
                        maxBulkDeleteRows: config.maxBulkDeleteRows,
                        readOnlyMode: config.readOnly
                    },
                    notes: [
                        `Cosmos version ${getVersionInfo().version}.`,
                        'Programmatic DDL is applied at process start; there is no separate migrate step to run in production.'
                    ],
                    modelCount
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_db_settings_summary',
        {
            description:
                'Summarise the persisted Cosmos runtime configuration held in the database (economy multiplier, house vault totals, scheduled deletions, pending notifications, queued broadcasts) so you can orient yourself before mutating anything.',
            inputSchema: {},
            handler: async () => {
                const [economy, vault, scheduled, outboxPending, broadcastQueued, userCount, groupCount] =
                    await Promise.all([
                        prisma.economyMultiplier.findFirst({ orderBy: { appliedAt: 'desc' } }),
                        prisma.houseVault.findFirst(),
                        prisma.scheduledDeletion.count(),
                        prisma.statusNotificationOutbox.count({ where: { status: 'PENDING' } }),
                        prisma.statusNotificationOutbox.count({ where: { event: 'BROADCAST', status: 'PENDING' } }),
                        prisma.user.count(),
                        prisma.whitelistedGroup.count()
                    ]);

                return {
                    cosmosVersion: getVersionInfo().version,
                    users: userCount,
                    whitelistedGroups: groupCount,
                    latestEconomyMultiplier: economy
                        ? {
                              multiplier: economy.multiplier,
                              appliedAt: economy.appliedAt.toISOString(),
                              reasoning: economy.reasoning
                          }
                        : null,
                    houseVault: vault
                        ? {
                              income: vault.income.toString(),
                              payout: vault.payout.toString(),
                              netProfit: vault.netProfit.toString()
                          }
                        : null,
                    pendingScheduledDeletions: scheduled,
                    pendingStatusNotifications: outboxPending,
                    queuedBroadcastDeliveries: broadcastQueued
                };
            }
        },
        deps,
        summary
    );
};
