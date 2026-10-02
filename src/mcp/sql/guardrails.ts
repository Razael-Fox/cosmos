/**
 * Cosmos MCP Server — SQL guardrails.
 *
 * `cosmos_db_query` is read-only, parameterised, mandatory-limited, and refuses
 * credential-bearing tables outright. These predicates are the single source of
 * truth for those rules so they can be unit-tested without a database.
 */
import { loadMcpConfig } from '../config.js';
import { McpToolError } from '../errors.js';

/**
 * Tables that hold credential or secret material. Refused with
 * `FORBIDDEN_TABLE` regardless of the columns selected.
 */
export const DENYLISTED_TABLES: Readonly<Record<string, string>> = {
    WhatsAppAuth: 'Baileys session credentials',
    WebSession: 'Web session token hashes',
    UserContactBook: 'Encrypted contact identifiers',
    OtpVerification: 'One-time-password hashes and salts'
};

/**
 * Columns that must never be projected, even from an otherwise allowed table.
 * Refused with `FORBIDDEN_COLUMN`.
 */
export const DENYLISTED_COLUMNS: Readonly<Record<string, string>> = {
    passwordHash: 'Credential hash',
    tokenHash: 'Session token hash',
    deviceTokenHash: 'Device token hash',
    codeHash: 'One-time-password hash',
    salt: 'One-time-password salt',
    lookupHash: 'One-time-password lookup hash',
    encryptedJid: 'Encrypted contact identifier',
    value: 'Serialized credential blob'
};

/**
 * High-value tables for which a `WHERE` clause is mandatory, so an agent can
 * never dump an entire ledger.
 */
export const WHERE_REQUIRED_TABLES: ReadonlySet<string> = new Set([
    'User',
    'BankAccount',
    'BankTransaction',
    'Loan',
    'LoanReminder',
    'UserContactBook',
    'UserInventory',
    'PropertyTransaction',
    'ActivityLog',
    'PaymentTransaction',
    'IdCard',
    'HouseVault'
]);

/** SQL verbs that may never reach SQLite through the MCP surface. */
const FORBIDDEN_SQL_PATTERN =
    /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|release|analyze)\b/i;

/** Statements that legitimately contain a forbidden word as an identifier. */
const ALLOWED_LITERAL_ALLOWLIST: readonly string[] = [
    'updatedAt',
    'createdAt',
    'nextAttemptAt',
    'created_at',
    'replace'
];

export interface ParsedSelect {
    /** Table the statement selects from. */
    table: string;
    /** `true` when a `WHERE` clause is present. */
    hasWhere: boolean;
    /** `true` when a `LIMIT` clause is present. */
    hasLimit: boolean;
}

/**
 * Very small, deliberately strict validator for the single-statement `SELECT`
 * dialect the MCP surface accepts. It is not a SQL parser: anything it cannot
 * fully account for is refused rather than guessed at.
 */
export function parseSelect(sql: string): ParsedSelect {
    const trimmed = sql.trim().replace(/;\s*$/, '');

    if (FORBIDDEN_SQL_PATTERN.test(trimmed)) {
        // Re-check against the allowlist so identifiers such as `updatedAt` or
        // a column literally named `create` do not produce false positives.
        const withoutIdentifiers = trimmed.replace(/\b\w+\b/g, (word) =>
            ALLOWED_LITERAL_ALLOWLIST.includes(word) ? ' ' : word
        );
        if (FORBIDDEN_SQL_PATTERN.test(withoutIdentifiers)) {
            throw new McpToolError(
                'FORBIDDEN_SQL',
                'Only a single read-only SELECT statement is permitted. Write operations must go through cosmos_db_mutation_plan and cosmos_db_apply_mutation.'
            );
        }
    }

    if (!/^\s*select\b/i.test(trimmed)) {
        throw new McpToolError('FORBIDDEN_SQL', 'Only a single read-only SELECT statement is permitted.');
    }

    if (trimmed.includes(';')) {
        throw new McpToolError(
            'FORBIDDEN_SQL',
            'Only a single statement is permitted. Remove the statement separator.'
        );
    }

    const fromMatch = /\bfrom\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(trimmed);
    if (!fromMatch) {
        throw new McpToolError('INVALID_SQL', 'The SELECT statement must declare a single FROM table.');
    }

    return {
        table: fromMatch[1],
        hasWhere: /\bwhere\b/i.test(trimmed),
        hasLimit: /\blimit\b/i.test(trimmed)
    };
}

/** Throws `FORBIDDEN_TABLE` when the table is on the credential denylist. */
export function assertTableAllowed(table: string): void {
    if (DENYLISTED_TABLES[table]) {
        throw new McpToolError(
            'FORBIDDEN_TABLE',
            `Access to the ${table} table is refused because it stores ${DENYLISTED_TABLES[table]}.`,
            {
                table
            }
        );
    }
}

/** Throws `FORBIDDEN_TABLE` when the statement joins a denylisted table. */
export function assertNoDenylistedTable(sql: string): void {
    for (const table of Object.keys(DENYLISTED_TABLES)) {
        if (new RegExp(`\\b${table}\\b`, 'i').test(sql)) {
            throw new McpToolError(
                'FORBIDDEN_TABLE',
                `The ${table} table is not readable through the Cosmos MCP surface.`,
                { table }
            );
        }
    }
}

/**
 * Validates a projected column list against the denylist. `columns` may be
 * empty, meaning "every column", in which case an explicit projection is
 * required instead so a denylisted column can never leak by accident.
 */
export function assertColumnsAllowed(table: string, columns: string[]): void {
    if (columns.length === 0) {
        throw new McpToolError(
            'FORBIDDEN_COLUMN',
            'An explicit column projection is required so credential columns can never be selected by accident. Use cosmos_db_describe to list the columns.'
        );
    }
    for (const raw of columns) {
        const column = raw.trim().replace(/["'`]/g, '');
        if (DENYLISTED_COLUMNS[column]) {
            throw new McpToolError(
                'FORBIDDEN_COLUMN',
                `The ${table}.${column} column is not readable because it stores ${DENYLISTED_COLUMNS[column]}.`,
                {
                    table,
                    column
                }
            );
        }
    }
}

/** Throws `MISSING_WHERE_CLAUSE` for high-value tables queried without a filter. */
export function assertWhereClause(table: string, hasWhere: boolean): void {
    if (WHERE_REQUIRED_TABLES.has(table) && !hasWhere) {
        throw new McpToolError(
            'MISSING_WHERE_CLAUSE',
            `A WHERE clause is mandatory when reading ${table}. Narrow the query to the records you actually need.`,
            { table }
        );
    }
}

/** Clamps a caller-supplied limit into `[1, maxQueryLimit]`. */
export function clampLimit(requested?: number): number {
    const { defaultQueryLimit, maxQueryLimit } = loadMcpConfig();
    if (requested === undefined || !Number.isFinite(requested)) return defaultQueryLimit;
    return Math.min(maxQueryLimit, Math.max(1, Math.trunc(requested)));
}
