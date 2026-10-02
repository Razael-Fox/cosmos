/**
 * Cosmos MCP Server — DDL mirror inspection and Rule W / Rule X validation.
 *
 * Cosmos keeps TWO sources of truth for the SQLite schema (AGENTS.md Rule W):
 *   1. `prisma/schema.prisma`                     — the canonical model list.
 *   2. `src/db.ts` and `.worktrees/api/src/db.ts` — mirrored `better-sqlite3`
 *      DDL bootstraps that must be edited in lockstep.
 *
 * `cosmos_schema_check` turns that prose rule into a machine-checkable pass/fail
 * report so a coding agent can detect drift without reading 800 lines of DDL.
 */
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '#utils/versioning.js';
import { loadSchemaCatalogue, type SchemaCatalogue } from './prismaCatalog.js';

/** The two DDL drivers Rule W requires to be maintained symmetrically. */
export const DDL_DRIVERS = [
    { label: 'bot', relativePath: 'src/db.ts' },
    { label: 'api', relativePath: '.worktrees/api/src/db.ts' }
] as const;

export interface DdlDriverReport {
    label: string;
    relativePath: string;
    /** `false` when the driver file is not present in this deployment. */
    available: boolean;
    /** `true` when the file contains a `better-sqlite3` schema bootstrap. */
    hasBootstrap: boolean;
    /** Tables declared with `CREATE TABLE IF NOT EXISTS`, sorted. */
    tables: string[];
    /** `ALTER TABLE ... ADD COLUMN` calls, as `Table.column` strings, sorted. */
    incrementalColumns: string[];
    /** `CREATE INDEX IF NOT EXISTS` targets, as `Table` names, sorted. */
    indexedTables: string[];
    /** Models from `schema.prisma` missing a `CREATE TABLE` here. */
    missingTables: string[];
    /** Index targets declared before the column they need is guaranteed. */
    prematureIndexes: string[];
}

export interface SchemaCheckReport {
    schemaPrisma: { available: boolean; modelCount: number; sourcePath: string | null };
    drivers: DdlDriverReport[];
    /** `true` when both drivers declare the same table set. */
    mirrorSymmetric: boolean;
    /** `true` when no driver indexes a column before guaranteeing it exists. */
    migrationOrderValid: boolean;
    /** `true` when both drivers were available for comparison. */
    driversComparable: boolean;
    findings: string[];
}

/** Extracts `CREATE TABLE IF NOT EXISTS "X"` occurrences from a DDL source. */
function extractTables(source: string): Set<string> {
    const tables = new Set<string>();
    const pattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
    let match = pattern.exec(source);
    while (match) {
        tables.add(match[1]);
        match = pattern.exec(source);
    }
    return tables;
}

/** Extracts `ALTER TABLE "X" ADD COLUMN "y"` calls issued via `ensureColumnExists`. */
function extractIncrementalColumns(source: string): Set<string> {
    const columns = new Set<string>();
    const pattern =
        /ensureColumnExists\(\s*db\s*,\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*,\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
    let match = pattern.exec(source);
    while (match) {
        columns.add(`${match[1]}.${match[2]}`);
        match = pattern.exec(source);
    }
    return columns;
}

/** Extracts `CREATE INDEX IF NOT EXISTS "X_yyy" ON "X"("col")` targets. */
function extractIndexes(source: string): Array<{ name: string; table: string; column: string }> {
    const indexes: Array<{ name: string; table: string; column: string }> = [];
    const pattern =
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s+ON\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s*\(\s*["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
    let match = pattern.exec(source);
    while (match) {
        indexes.push({ name: match[1], table: match[2], column: match[3] });
        match = pattern.exec(source);
    }
    return indexes;
}

/** Resolves a driver path from the repository root, tolerating container layouts. */
export function resolveDriverPath(relativePath: string): string {
    const candidates = [
        path.resolve(REPO_ROOT, relativePath),
        path.resolve(process.cwd(), relativePath),
        path.resolve(process.cwd(), '..', relativePath),
        path.resolve(process.cwd(), '..', '..', relativePath)
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function inspectDriver(label: string, relativePath: string, catalogue: SchemaCatalogue | null): DdlDriverReport {
    const absolutePath = resolveDriverPath(relativePath);
    if (!fs.existsSync(absolutePath)) {
        return {
            label,
            relativePath,
            available: false,
            hasBootstrap: false,
            tables: [],
            incrementalColumns: [],
            indexedTables: [],
            missingTables: catalogue ? catalogue.models.map((model) => model.name) : [],
            prematureIndexes: []
        };
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    const tables = extractTables(source);
    const incrementalColumns = extractIncrementalColumns(source);
    const indexes = extractIndexes(source);

    const prematureIndexes: string[] = [];
    for (const index of indexes) {
        const guaranteed = tables.has(index.table) || incrementalColumns.has(`${index.table}.${index.column}`);
        if (!guaranteed && !catalogue) continue;
        // An index on a column that neither the CREATE TABLE block nor an
        // `ensureColumnExists` call guarantees will fail with `no such column`
        // on a legacy database (Rule W).
        if (!guaranteed) prematureIndexes.push(`${index.name} -> ${index.table}.${index.column}`);
    }

    const missingTables = catalogue
        ? catalogue.models.map((model) => model.name).filter((name) => !tables.has(name))
        : [];

    return {
        label,
        relativePath,
        available: true,
        hasBootstrap: /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(source),
        tables: [...tables].sort(),
        incrementalColumns: [...incrementalColumns].sort(),
        indexedTables: [...new Set(indexes.map((index) => index.table))].sort(),
        missingTables,
        prematureIndexes
    };
}

/**
 * Runs the Rule W dual-maintenance check and the Rule W 3-phase migration-order
 * check across both DDL drivers.
 */
export function runSchemaChecks(): SchemaCheckReport {
    const catalogue = loadSchemaCatalogue();
    const schemaAvailable = catalogue !== null;
    const drivers = DDL_DRIVERS.map((driver) => inspectDriver(driver.label, driver.relativePath, catalogue));

    const findings: string[] = [];

    if (!schemaAvailable) {
        findings.push('prisma/schema.prisma could not be located, so no drift comparison was possible.');
    }

    const availableDrivers = drivers.filter((driver) => driver.available);
    const driversComparable = availableDrivers.length === DDL_DRIVERS.length;

    for (const driver of availableDrivers) {
        if (!driver.hasBootstrap) {
            findings.push(
                `${driver.relativePath} contains no CREATE TABLE bootstrap; it may not bootstrap the schema.`
            );
        }
        for (const premature of driver.prematureIndexes) {
            findings.push(
                `${driver.relativePath}: index ${premature} is declared without a guaranteed column. Rule W requires CREATE TABLE, then ensureColumnExists, then CREATE INDEX.`
            );
        }
        for (const missing of driver.missingTables) {
            findings.push(
                `${driver.relativePath} declares no CREATE TABLE for ${missing}. Rule W dual maintenance requires this driver to mirror prisma/schema.prisma.`
            );
        }
    }

    if (!driversComparable) {
        const absent = drivers.filter((driver) => !driver.available).map((driver) => driver.relativePath);
        findings.push(
            `DDL driver(s) unavailable in this deployment: ${absent.join(', ')}. Rule W dual maintenance could not be verified.`
        );
    }

    const mirrorSymmetric =
        driversComparable &&
        availableDrivers.every(
            (driver) => JSON.stringify(driver.tables) === JSON.stringify([...availableDrivers[0].tables].sort())
        );

    if (driversComparable && !mirrorSymmetric) {
        findings.push(
            'The bot and API DDL drivers do not declare the same table set. Rule W requires symmetric maintenance.'
        );
    }

    const migrationOrderValid = availableDrivers.every((driver) => driver.prematureIndexes.length === 0);

    return {
        schemaPrisma: {
            available: schemaAvailable,
            modelCount: catalogue?.modelCount ?? 0,
            sourcePath: catalogue?.sourcePath ?? null
        },
        drivers,
        mirrorSymmetric,
        migrationOrderValid,
        driversComparable,
        findings
    };
}
