/**
 * Cosmos MCP Server — mutation planner.
 *
 * `cosmos_db_mutation_plan` is the answer to the failure mode described in issue
 * #49: an agent that "knows" Cosmos wants to hand-edit `schema.prisma`, forget
 * the mirrored `better-sqlite3` DDL driver, or write raw SQL that desynchronises
 * the two sources of truth.
 *
 * The planner is a pure, side-effect-free function. It answers, for one intended
 * mutation:
 *   (a) whether the change is safe to apply directly,
 *   (b) the exact `prisma.$transaction` boilerplate Cosmos requires,
 *   (c) whether Rule W's 3-phase DDL is required in BOTH `src/db.ts` and
 *       `.worktrees/api/src/db.ts`,
 *   (d) whether the change touches an ACID-guarded domain and therefore needs a
 *       `balanceAfter` record plus an `ActivityLog` entry, and
 *   (e) the i18n / schema-mirror checklist.
 *
 * It writes nothing. `cosmos_db_apply_mutation` refuses to execute unless this
 * planner returned `safe: true` for the identical request.
 */
import { findModel, loadSchemaCatalogue, type SchemaModel } from './prismaCatalog.js';
import { DENYLISTED_TABLES } from '../sql/guardrails.js';
import { McpToolError } from '../errors.js';

export type MutationOperation = 'create' | 'update' | 'upsert' | 'delete' | 'drop';

export interface MutationRequest {
    model: string;
    operation: MutationOperation;
    /** Column assignments for `create`, `update`, and `upsert`. */
    set?: Record<string, unknown>;
    /** Equality filters identifying the affected rows. */
    where?: Record<string, unknown>;
    /** Explicit column list for `create`. Defaults to the keys of `set`. */
    columns?: string[];
}

export interface PlanChecklistItem {
    rule: string;
    requirement: string;
    satisfied: boolean;
}

export interface MutationPlan {
    safe: boolean;
    model: string;
    operation: MutationOperation;
    /** Tables that must be edited in lockstep when the schema changes. */
    mirrorTargets: string[];
    /** `true` when the change requires new columns or a new table. */
    requiresSchemaChange: boolean;
    /** `true` when the change alters existing column definitions. */
    requiresDdlMigration: boolean;
    /** `true` for an ACID-guarded domain (bank / loan / economy / inventory). */
    requiresAcidTransaction: boolean;
    /** `true` when a `balanceAfter` value must be recorded. */
    requiresBalanceAfter: boolean;
    /** `true` when an `ActivityLog` row must be written. */
    requiresActivityLog: boolean;
    /** `true` when the statement must run inside `prisma.$transaction`. */
    requiresTransaction: boolean;
    /** `true` for a destructive operation, requiring `confirm: true`. */
    destructive: boolean;
    /** Rows the operation would touch, when it can be counted safely. */
    affectedRowCount: number | null;
    /** Blocking problems. Empty when `safe` is true. */
    blockers: string[];
    /**
     * Fields the request referenced that `cosmos_db_describe` does not report.
     *
     * Machine-readable counterpart to the prose blockers, so a caller can branch
     * on an invented column instead of pattern-matching prose. This is what makes
     * the `UNKNOWN_FIELD` error code reachable.
     */
    unknownFields: string[];
    /** Non-blocking advisories. */
    warnings: string[];
    /** The Prisma call the agent should make. */
    prismaSnippet: string;
    /** Copy-paste `$transaction` boilerplate. */
    transactionSnippet: string;
    /** Prisma field selector derived from `where`. */
    whereSelector: string;
    /** Checklist an agent must satisfy before applying the change. */
    checklist: PlanChecklistItem[];
}

/** ACID-guarded domains per AGENTS.md Rules P, Q, R. */
const ACID_TABLES: Readonly<Record<string, { acid: true; balanceAfter: boolean; domain: string }>> = {
    BankAccount: { acid: true, balanceAfter: false, domain: 'bank' },
    BankTransaction: { acid: true, balanceAfter: true, domain: 'bank' },
    Loan: { acid: true, balanceAfter: false, domain: 'loan' },
    LoanReminder: { acid: true, balanceAfter: false, domain: 'loan' },
    PaymentTransaction: { acid: true, balanceAfter: false, domain: 'billing' },
    User: { acid: true, balanceAfter: false, domain: 'economy' },
    EconomyMultiplier: { acid: true, balanceAfter: false, domain: 'economy' },
    HouseVault: { acid: true, balanceAfter: false, domain: 'economy' },
    ExchangeRateLog: { acid: true, balanceAfter: false, domain: 'economy' },
    UserInventory: { acid: true, balanceAfter: false, domain: 'inventory' },
    PropertyTransaction: { acid: true, balanceAfter: false, domain: 'inventory' },
    IdCard: { acid: true, balanceAfter: false, domain: 'identity' },
    JobCatalog: { acid: true, balanceAfter: false, domain: 'economy' }
};

/** Columns whose change mandates a DDL migration rather than a row update. */
const STRUCTURAL_FIELD_PATTERN = /^(type|precision|scale|length)$/i;

function jsonLiteral(value: unknown): string {
    if (value === null) return 'null';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'object') return JSON.stringify(value);
    return JSON.stringify(value);
}

function renderWhereSelector(where: Record<string, unknown> = {}): string {
    const entries = Object.entries(where);
    if (entries.length === 0) return '{}';
    const rendered = entries.map(([field, value]) => `    ${field}: ${jsonLiteral(value)}`).join(',\n');
    return `{\n${rendered}\n  }`;
}

function renderData(set: Record<string, unknown> = {}): string {
    const entries = Object.entries(set);
    if (entries.length === 0) return '{}';
    const rendered = entries.map(([field, value]) => `        ${field}: ${jsonLiteral(value)}`).join(',\n');
    return `{\n${rendered}\n    }`;
}

/**
 * New columns cannot be detected from a row mutation alone, so the planner
 * compares the requested `set` keys against the live catalogue and treats any
 * key that is absent from the model as a schema change.
 */
function unknownFields(model: SchemaModel, fields: string[]): string[] {
    const known = new Set(model.fields.map((field) => field.name));
    return fields.filter((field) => !known.has(field));
}

/**
 * Builds a dry-run plan for one intended mutation. Pure: never touches the
 * database, never writes, never sends anything.
 *
 * @throws {McpToolError} `UNKNOWN_MODEL` when the model is absent from
 * `prisma/schema.prisma`; `INVALID_PAYLOAD` when the request is malformed.
 */
export function planMutation(request: MutationRequest): MutationPlan {
    const modelName = request.model?.trim();
    if (!modelName) {
        throw new McpToolError('INVALID_PAYLOAD', 'A model name is required.');
    }

    const catalogue = loadSchemaCatalogue();
    if (!catalogue) {
        throw new McpToolError(
            'NOT_FOUND',
            'prisma/schema.prisma could not be located, so no mutation plan can be produced.'
        );
    }

    const model = findModel(catalogue, modelName);
    if (!model) {
        throw new McpToolError(
            'UNKNOWN_MODEL',
            `The model ${modelName} does not exist in prisma/schema.prisma. Call cosmos_db_describe for the live model list.`,
            {
                availableModels: catalogue.models.map((entry) => entry.name)
            }
        );
    }

    const setEntries = Object.keys(request.set ?? {});
    const whereEntries = Object.keys(request.where ?? {});
    const operation = request.operation;

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (DENYLISTED_TABLES[model.name]) {
        blockers.push(
            `The ${model.name} table stores ${DENYLISTED_TABLES[model.name]} and is not writable through the Cosmos MCP surface.`
        );
    }

    if (operation === 'drop') {
        blockers.push(
            'Dropping a model is never permitted through the Cosmos MCP surface. Write an explicit migration instead.'
        );
    }

    if ((operation === 'update' || operation === 'delete' || operation === 'upsert') && whereEntries.length === 0) {
        blockers.push(
            `A ${operation} without a \`where\` filter would affect every row in ${model.name}. Narrow the filter first.`
        );
    }

    if ((operation === 'create' || operation === 'update' || operation === 'upsert') && setEntries.length === 0) {
        blockers.push(`A ${operation} requires a non-empty \`set\` object.`);
    }

    const absentSetFields = unknownFields(model, setEntries);
    const absentWhereFields = unknownFields(model, whereEntries);

    for (const field of absentSetFields) {
        blockers.push(
            `\`${model.name}.${field}\` does not exist in prisma/schema.prisma. Call cosmos_db_describe before mutating; invented columns are refused.`
        );
    }
    for (const field of absentWhereFields) {
        blockers.push(
            `\`${model.name}.${field}\` does not exist in prisma/schema.prisma, so it cannot be used as a filter.`
        );
    }

    const structuralChange = setEntries.some((field) => STRUCTURAL_FIELD_PATTERN.test(field));
    const requiresSchemaChange = absentSetFields.length > 0 || absentWhereFields.length > 0;
    const requiresDdlMigration = requiresSchemaChange || structuralChange;

    const acidProfile = ACID_TABLES[model.name];
    const requiresAcidTransaction = Boolean(acidProfile?.acid);
    const requiresTransaction = requiresAcidTransaction || operation !== 'create';
    const requiresBalanceAfter =
        Boolean(acidProfile?.balanceAfter) || (acidProfile?.acid === true && /balance/i.test(setEntries.join(' ')));
    const requiresActivityLog = requiresAcidTransaction || operation !== 'create';
    const destructive = operation === 'delete' || operation === 'drop';

    if (
        operation === 'create' &&
        model.fields.some((field) => !field.isOptional && field.default === undefined && field.isUpdatedAt === false)
    ) {
        const required = model.fields
            .filter(
                (field) =>
                    !field.isOptional && field.default === undefined && !field.isUpdatedAt && field.type !== 'Int'
            )
            .map((field) => field.name);
        if (required.length > 0 && absentSetFields.length === 0) {
            warnings.push(`Fields without a default must be supplied for a create: ${required.join(', ')}.`);
        }
    }

    if (requiresSchemaChange) {
        warnings.push(
            'This mutation introduces a field absent from prisma/schema.prisma. Apply the Rule W 3-phase DDL in BOTH src/db.ts and .worktrees/api/src/db.ts before the row can be written.'
        );
    }

    if (requiresAcidTransaction) {
        warnings.push(
            `${model.name} is an ACID-guarded ${acidProfile?.domain ?? 'ledger'} domain. Re-validate the affected row inside prisma.$transaction and guard against concurrent in-flight mutations.`
        );
    }

    if (requiresBalanceAfter) {
        warnings.push('Record the resulting `balanceAfter` value on the accompanying transaction row.');
    }

    const whereSelector = renderWhereSelector(request.where);
    const dataBlock = renderData(request.set);

    let prismaSnippet: string;
    switch (operation) {
        case 'create':
            prismaSnippet = `await tx.${lowerFirst(model.name)}.create({\n    data: ${dataBlock}\n});`;
            break;
        case 'update':
            // `updateMany` so the call reports how many rows actually changed,
            // which is what the executor runs inside the transaction.
            prismaSnippet = `await tx.${lowerFirst(model.name)}.updateMany({\n    where: ${whereSelector},\n    data: ${dataBlock}\n});`;
            break;
        case 'upsert':
            prismaSnippet = `await tx.${lowerFirst(model.name)}.upsert({\n    where: ${whereSelector},\n    create: ${dataBlock},\n    update: ${dataBlock}\n});`;
            break;
        case 'delete':
            prismaSnippet = `await tx.${lowerFirst(model.name)}.deleteMany({\n    where: ${whereSelector}\n});`;
            break;
        default:
            prismaSnippet = '/* unsupported operation */';
    }

    const transactionSnippet = `await prisma.$transaction(async (tx) => {\n${indented(prismaSnippet, '    ')}\n${
        requiresActivityLog
            ? `\n    // Required: append an ActivityLog row inside the same transaction.\n    await tx.activityLog.create({\n        data: {\n            userId: '<acting owner jid>',\n            type: 'MCP_MUTATION',\n            description: '<Formal English summary of the change>'\n        }\n    });\n`
            : ''
    }${requiresBalanceAfter ? '\n    // Required: persist the resulting balanceAfter on the transaction row.\n' : ''}});`;

    const checklist: PlanChecklistItem[] = [
        {
            rule: 'W (SQLite schema migration precedence)',
            requirement:
                'When a column or table is added, apply the 3-phase DDL order in both drivers: CREATE TABLE, then ensureColumnExists, then CREATE INDEX.',
            satisfied: !requiresDdlMigration
        },
        {
            rule: 'W (dual maintenance)',
            requirement: 'Mirror every schema change in src/db.ts AND .worktrees/api/src/db.ts.',
            satisfied: !requiresDdlMigration
        },
        {
            rule: 'P/Q/R (ACID double-entry)',
            requirement: 'Wrap the change in prisma.$transaction and re-validate state inside it.',
            satisfied: !requiresTransaction
        },
        {
            rule: 'P (balanceAfter)',
            requirement: 'Record the resulting balanceAfter on the accompanying BankTransaction row.',
            satisfied: !requiresBalanceAfter
        },
        {
            rule: 'Rule C (Pterodactyl visibility)',
            requirement: 'Print the change to console.log so it is visible in the panel.',
            satisfied: false
        },
        {
            rule: 'Rule O (i18n)',
            requirement:
                'Add any new user-facing string to BOTH src/locales/en and src/locales/id under a matching key.',
            satisfied: true
        },
        {
            rule: 'Rule T (command i18n)',
            requirement:
                'If a command was added or renamed, register tools.commands.<clean_name>.description symmetrically in en and id.',
            satisfied: true
        }
    ];

    return {
        safe: blockers.length === 0,
        model: model.name,
        operation,
        mirrorTargets: requiresDdlMigration ? ['prisma/schema.prisma', 'src/db.ts', '.worktrees/api/src/db.ts'] : [],
        requiresSchemaChange,
        requiresDdlMigration,
        requiresAcidTransaction,
        requiresBalanceAfter,
        requiresActivityLog,
        requiresTransaction,
        destructive,
        affectedRowCount: null,
        blockers,
        unknownFields: [...absentSetFields, ...absentWhereFields],
        warnings,
        prismaSnippet,
        transactionSnippet,
        whereSelector,
        checklist
    };
}

function lowerFirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function indented(text: string, prefix: string): string {
    return text
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n');
}

/**
 * Stable fingerprint of a mutation request. `cosmos_db_apply_mutation` recomputes
 * this and refuses to execute unless it matches the plan it was given, so a plan
 * can never be reused for a different mutation.
 */
export function fingerprintMutation(request: MutationRequest): string {
    const normalized = {
        model: request.model?.trim().toLowerCase(),
        operation: request.operation,
        set: sortKeys(request.set ?? {}),
        where: sortKeys(request.where ?? {})
    };
    return JSON.stringify(normalized);
}

function sortKeys(source: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
        sorted[key] = source[key];
    }
    return sorted;
}
