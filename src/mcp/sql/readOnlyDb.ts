/**
 * Cosmos MCP Server — read-only SQLite access.
 *
 * Every connection is opened with `readonly: true` and `fileMustExist: true`, so
 * the MCP surface physically cannot write to the database even if a guardrail
 * were bypassed. Combined with {@link assertSelectSafe} this makes
 * `cosmos_db_query` safe by construction.
 */
import Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import { resolveStatusDatabasePath } from '#services/notifier/dbPath.js';
import { loadMcpConfig } from '../config.js';
import { McpToolError } from '../errors.js';
import { maskDeep } from '../privacy.js';
import {
    assertColumnsAllowed,
    assertNoDenylistedTable,
    assertTableAllowed,
    assertWhereClause,
    clampLimit,
    parseSelect
} from './guardrails.js';

export interface QueryResult {
    /** Column names in projection order. */
    columns: string[];
    /** Rows, with `BIGINT` rendered as a decimal string and contacts masked. */
    rows: Array<Record<string, unknown>>;
    /** Number of rows returned. */
    rowCount: number;
    /** Effective `LIMIT` applied to the statement. */
    limit: number;
    /** The validated statement that was executed. */
    sql: string;
    /** Bound parameters. */
    params: unknown[];
}

let cachedConnection: { path: string; db: Database.Database } | null = null;

/**
 * Releases a prepared statement. `better-sqlite3` exposes `finalize()` at
 * runtime but its bundled typings omit it, so the call is narrowed here.
 */
function releaseStatement(statement: Statement): void {
    try {
        (statement as unknown as { finalize?: () => void }).finalize?.();
    } catch {
        /* the handle is released when the connection closes */
    }
}

function openReadOnlyConnection(): Database.Database {
    const dbPath = resolveStatusDatabasePath();
    if (cachedConnection && cachedConnection.path === dbPath) return cachedConnection.db;
    try {
        cachedConnection?.db.close();
    } catch {
        /* ignore close failures on a stale handle */
    }
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    cachedConnection = { path: dbPath, db };
    return db;
}

/** Test seam: closes the cached read-only handle. */
export function closeReadOnlyConnection(): void {
    try {
        cachedConnection?.db.close();
    } catch {
        /* ignore */
    }
    cachedConnection = null;
}

/** Converts SQLite's native values into JSON-safe, privacy-masked values. */
function normalizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
    if (value instanceof Date) return value.toISOString();
    return maskDeep(value);
}

function rowsToRecords(rows: unknown[]): { columns: string[]; records: Array<Record<string, unknown>> } {
    const columns: string[] = [];
    const records: Array<Record<string, unknown>> = [];
    for (const row of rows) {
        const record: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
            columns.push(key);
            record[key] = normalizeValue(value);
        }
        records.push(record);
    }
    return { columns: [...new Set(columns)], records };
}

/**
 * Runs a guarded, read-only `SELECT`.
 *
 * Validation performed before execution:
 *  1. Single-statement read-only `SELECT` (see {@link parseSelect}).
 *  2. The `FROM` table and every joined table is off the credential denylist.
 *  3. The projected columns are off the credential-column denylist, and an
 *     explicit projection is mandatory.
 *  4. A `WHERE` clause is mandatory for high-value ledger tables.
 *  5. A `LIMIT` is mandatory and is clamped to the configured ceiling.
 */
export function runGuardedSelect(options: {
    sql: string;
    params?: unknown[];
    limit?: number;
    /** Explicit projection used for the denylist check; defaults to `*`. */
    columns?: string[];
}): QueryResult {
    const parsed = parseSelect(options.sql);
    assertTableAllowed(parsed.table);
    assertNoDenylistedTable(options.sql);
    assertColumnsAllowed(parsed.table, options.columns ?? extractProjection(options.sql));
    assertWhereClause(parsed.table, parsed.hasWhere);

    const limit = clampLimit(options.limit);
    if (!parsed.hasLimit) {
        throw new McpToolError(
            'INVALID_SQL',
            `A LIMIT clause is mandatory. cosmos_db_query appends LIMIT ${limit}; remove it only if you need a different, smaller value.`,
            { suggestedLimit: limit }
        );
    }

    let statement: Statement;
    try {
        statement = openReadOnlyConnection().prepare(options.sql);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new McpToolError('INVALID_SQL', `SQLite rejected the statement: ${message}`);
    }

    try {
        const rows = statement.all(...(options.params ?? [])) as unknown[];
        const { columns, records } = rowsToRecords(rows);
        return {
            columns,
            rows: records,
            rowCount: records.length,
            limit,
            sql: options.sql,
            params: options.params ?? []
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new McpToolError('INVALID_SQL', `SQLite rejected the statement: ${message}`);
    } finally {
        releaseStatement(statement);
    }
}

/** Extracts the raw projection list from a `SELECT` clause, or `['*']`. */
export function extractProjection(sql: string): string[] {
    const match = /^\s*select\s+(distinct\s+)?(.+?)\s+from\b/is.exec(sql.trim());
    if (!match) return ['*'];
    const projection = match[2].trim();
    if (projection === '*' || /,\s*\*/.test(projection)) return ['*'];
    return projection
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => part.split(/\s+as\s+/i)[0].trim())
        .filter((part) => part.length > 0);
}

/**
 * `cosmos_db_count` — a `COUNT(*)` / `COUNT(column)` helper so an agent never
 * hand-rolls aggregation SQL. Applies exactly the same guardrails as a query.
 */
export function runCount(options: { table: string; where?: string; params?: unknown[] }): {
    table: string;
    count: number;
    sql: string;
    params: unknown[];
} {
    assertTableAllowed(options.table);
    if (options.where) {
        assertNoDenylistedTable(options.where);
        assertWhereClause(options.table, true);
    } else {
        assertWhereClause(options.table, false);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.table)) {
        throw new McpToolError('INVALID_PAYLOAD', 'The table name must be a plain identifier.');
    }

    const sql = options.where
        ? `SELECT COUNT(*) AS total FROM "${options.table}" WHERE ${options.where}`
        : `SELECT COUNT(*) AS total FROM "${options.table}"`;

    let statement: Statement;
    try {
        statement = openReadOnlyConnection().prepare(sql);
    } catch (err) {
        throw new McpToolError(
            'INVALID_SQL',
            `SQLite rejected the statement: ${err instanceof Error ? err.message : String(err)}`
        );
    }
    try {
        const row = statement.get(...(options.params ?? [])) as { total?: number } | undefined;
        return { table: options.table, count: Number(row?.total ?? 0), sql, params: options.params ?? [] };
    } finally {
        releaseStatement(statement);
    }
}

const AGGREGATES: Readonly<Record<string, 'SUM' | 'AVG' | 'MIN' | 'MAX'>> = {
    sum: 'SUM',
    avg: 'AVG',
    min: 'MIN',
    max: 'MAX'
};

/**
 * `cosmos_db_aggregate` — a `SUM` / `AVG` / `MIN` / `MAX` helper over a single
 * numeric column, grouped by an optional column.
 */
export function runAggregate(options: {
    table: string;
    column: string;
    aggregate: 'sum' | 'avg' | 'min' | 'max';
    groupBy?: string;
    where?: string;
    params?: unknown[];
    limit?: number;
}): {
    table: string;
    column: string;
    aggregate: string;
    groupBy?: string;
    groups: Array<Record<string, unknown>>;
    rowCount: number;
    sql: string;
    params: unknown[];
} {
    assertTableAllowed(options.table);
    const fn = AGGREGATES[options.aggregate];
    if (!fn) {
        throw new McpToolError('INVALID_PAYLOAD', 'The aggregate must be one of sum, avg, min, or max.');
    }
    for (const identifier of [options.table, options.column, options.groupBy]) {
        if (identifier !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
            throw new McpToolError('INVALID_PAYLOAD', 'Table, column, and group-by names must be plain identifiers.');
        }
    }
    if (options.where) assertNoDenylistedTable(options.where);
    assertWhereClause(options.table, Boolean(options.where));

    const groupProjection = options.groupBy ? `"${options.groupBy}", ` : '';
    const groupClause = options.groupBy ? ` GROUP BY "${options.groupBy}"` : '';
    const whereClause = options.where ? ` WHERE ${options.where}` : '';
    const orderClause = options.groupBy ? ` ORDER BY "${options.groupBy}" ASC` : '';
    const limit = clampLimit(options.limit);

    const sql = `SELECT ${groupProjection}${fn}("${options.column}") AS value FROM "${options.table}"${whereClause}${groupClause}${orderClause} LIMIT ${limit}`;

    let statement: Statement;
    try {
        statement = openReadOnlyConnection().prepare(sql);
    } catch (err) {
        throw new McpToolError(
            'INVALID_SQL',
            `SQLite rejected the statement: ${err instanceof Error ? err.message : String(err)}`
        );
    }
    try {
        const rows = statement.all(...(options.params ?? [])) as unknown[];
        const groups = rows.map((row) => {
            const record: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
                record[key] = normalizeValue(value);
            }
            return record;
        });
        return {
            table: options.table,
            column: options.column,
            aggregate: fn.toLowerCase(),
            groupBy: options.groupBy,
            groups,
            rowCount: groups.length,
            sql,
            params: options.params ?? []
        };
    } finally {
        releaseStatement(statement);
    }
}

/** Reports the resolved database path and whether the read-only handle opens. */
export function describeDatabase(): { path: string; readable: boolean; readOnly: boolean; queryLimit: number } {
    const { defaultQueryLimit } = loadMcpConfig();
    const dbPath = resolveStatusDatabasePath();
    try {
        openReadOnlyConnection();
        return { path: dbPath, readable: true, readOnly: true, queryLimit: defaultQueryLimit };
    } catch (err) {
        console.error('[MCP] Failed to open the read-only database handle:', err);
        return { path: dbPath, readable: false, readOnly: true, queryLimit: defaultQueryLimit };
    }
}
