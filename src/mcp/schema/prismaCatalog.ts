/**
 * Cosmos MCP Server — Prisma schema catalogue parser.
 *
 * `cosmos_db_describe` is the anti-hallucination anchor described in issue #49:
 * it returns the LIVE model list, fields, types, and relations parsed directly
 * from `prisma/schema.prisma`, so a coding agent can no longer invent a column
 * that does not exist.
 *
 * The parser is intentionally dependency-free and line-oriented rather than a
 * full Prisma grammar: it must stay correct across every model in the schema
 * and fail loudly (never silently) on anything it cannot classify.
 */
import fs from 'fs';
import path from 'path';

export interface SchemaField {
    name: string;
    /** Prisma scalar or enum type as written in the schema. */
    type: string;
    isList: boolean;
    isOptional: boolean;
    isId: boolean;
    isUnique: boolean;
    default?: string;
    /** Set when the field carries `@relation`, naming the related model. */
    relationTo?: string;
    /** Set when the field carries `@updatedAt`. */
    isUpdatedAt: boolean;
}

export interface SchemaIndex {
    fields: string[];
    unique: boolean;
}

export interface SchemaModel {
    name: string;
    /** `@@id([a, b])` composite primary key, when declared. */
    compositeId: string[] | null;
    /** `@@unique([a, b])` composite unique constraints. */
    uniqueGroups: string[][];
    indexes: SchemaIndex[];
    fields: SchemaField[];
    /** `enum` declarations this model references. */
    enums: string[];
}

export interface SchemaEnum {
    name: string;
    values: string[];
}

export interface SchemaCatalogue {
    /** Generator provider, e.g. `prisma-client`. */
    generator: string;
    /** Datasource provider, e.g. `sqlite`. */
    datasource: string;
    models: SchemaModel[];
    enums: SchemaEnum[];
    /** Absolute path the catalogue was parsed from. */
    sourcePath: string;
    /** Number of models, echoed for quick assertions. */
    modelCount: number;
}

function stripComment(line: string): string {
    // Prisma comments start with `//` and never appear inside a quoted default.
    let inString = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') inString = !inString;
        if (!inString && ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
}

/** Parses `@@index([a, b])` / `@@unique([a, b])` / `@@id([a, b])` payloads. */
function parseFieldList(payload: string): string[] {
    const open = payload.indexOf('(');
    const close = payload.lastIndexOf(')');
    if (open === -1 || close <= open) return [];
    const inner = payload
        .slice(open + 1, close)
        .replace(/^\s*\[/, '')
        .replace(/\]\s*$/, '');
    return inner
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/**
 * Extracts the balanced-paren payload of `@name(...)`. A non-greedy regex would
 * truncate nested calls such as `@default(now())` and `@default(autoincrement())`.
 */
function extractAttributePayload(attributes: string, name: string): string | undefined {
    const marker = `@${name}`;
    const start = attributes.indexOf(marker);
    if (start === -1) return undefined;
    const open = attributes.indexOf('(', start + marker.length);
    if (open === -1) return undefined;

    let depth = 0;
    for (let i = open; i < attributes.length; i += 1) {
        if (attributes[i] === '(') depth += 1;
        else if (attributes[i] === ')') {
            depth -= 1;
            if (depth === 0) return attributes.slice(open + 1, i);
        }
    }
    return undefined;
}

function parseField(raw: string): SchemaField {
    const body = raw.trim();
    const spaceIdx = body.indexOf(' ');
    const name = body.slice(0, spaceIdx).trim();
    let rest = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1).trim();

    let isList = false;
    let isOptional = false;
    if (rest.endsWith('[]')) {
        isList = true;
        rest = rest.slice(0, -2).trim();
    }
    if (rest.endsWith('?')) {
        isOptional = true;
        rest = rest.slice(0, -1).trim();
    }

    const spaceIdx2 = rest.indexOf(' ');
    const type = (spaceIdx2 === -1 ? rest : rest.slice(0, spaceIdx2)).trim();
    const attributes = spaceIdx2 === -1 ? '' : rest.slice(spaceIdx2 + 1);

    const defaultMatch = extractAttributePayload(attributes, 'default');

    return {
        name,
        type,
        isList,
        isOptional,
        isId: /@id\b/.test(attributes),
        isUnique: /@unique\b/.test(attributes),
        default: defaultMatch !== undefined ? defaultMatch.trim() : undefined,
        // Resolved in a second pass, once every model name is known.
        relationTo: /@relation\b/.test(attributes) ? '' : undefined,
        isUpdatedAt: /@updatedAt\b/.test(attributes)
    };
}

/**
 * Resolves the related model name of every relation field. A relation field is
 * one whose declared type is another model's name — either explicitly annotated
 * with `@relation`, or implicit (`loans Loan[]`). The field type is the
 * authoritative signal because a relation field's name is not always a scalar.
 */
function resolveRelationTargets(models: SchemaModel[]): void {
    const modelNames = new Set(models.map((model) => model.name));

    for (const model of models) {
        for (const field of model.fields) {
            if (field.relationTo !== undefined) {
                // Declared with `@relation`: keep it only when the type is a model.
                field.relationTo = modelNames.has(field.type) ? field.type : undefined;
                continue;
            }
            // Implicit relation: any field typed as another model, except the
            // self-referencing primary keys Prisma uses as relation anchors.
            if (!field.isId && modelNames.has(field.type)) {
                field.relationTo = field.type;
            }
        }
    }
}

export function parsePrismaSchema(schemaSource: string, sourcePath = '<memory>'): SchemaCatalogue {
    const lines = schemaSource.split(/\r?\n/);
    const models: SchemaModel[] = [];
    const enums: SchemaEnum[] = [];
    let generator = 'unknown';
    let datasource = 'unknown';

    /** Consumes a `{ ... }` block starting at `start`, returning its body lines. */
    const readBlock = (start: number): { body: string[]; next: number } => {
        const body: string[] = [];
        let cursor = start;
        while (cursor < lines.length && !stripComment(lines[cursor]).trim().startsWith('}')) {
            body.push(stripComment(lines[cursor]));
            cursor += 1;
        }
        return { body, next: cursor + 1 };
    };

    let i = 0;
    while (i < lines.length) {
        const line = stripComment(lines[i]).trim();
        i += 1;
        if (!line) continue;

        if (line.startsWith('generator ') || line.startsWith('datasource ')) {
            const kind = line.startsWith('generator ') ? 'generator' : 'datasource';
            let block = line;
            if (block.endsWith('{')) {
                const read = readBlock(i);
                block = `${block} ${read.body.join(' ')}`;
                i = read.next;
            }
            const providerMatch = /provider\s*=\s*"([^"]+)"/.exec(block);
            if (providerMatch) {
                if (kind === 'generator') generator = providerMatch[1];
                else datasource = providerMatch[1];
            }
            continue;
        }

        if (line.startsWith('enum ')) {
            const name = line
                .slice(5)
                .replace(/\s*\{$/, '')
                .trim();
            const read = readBlock(i);
            i = read.next;
            const values = read.body.map((entry) => stripComment(entry).trim()).filter((entry) => entry.length > 0);
            enums.push({ name, values });
            continue;
        }

        if (line.startsWith('model ')) {
            const name = line
                .slice(6)
                .replace(/\s*\{$/, '')
                .trim();
            const read = readBlock(i);
            i = read.next;
            const bodyLines = read.body;

            const model: SchemaModel = {
                name,
                compositeId: null,
                uniqueGroups: [],
                indexes: [],
                fields: [],
                enums: []
            };

            let depth = 0;
            let buffer = '';
            for (const rawLine of bodyLines) {
                const text = stripComment(rawLine).trim();
                if (!text) continue;
                const opens = (text.match(/[[({]/g) || []).length;
                const closes = (text.match(/[\])}]/g) || []).length;
                buffer = buffer ? `${buffer} ${text}` : text;
                depth += opens - closes;
                if (depth > 0) continue;
                depth = 0;

                const statement = buffer.trim();
                buffer = '';
                if (!statement) continue;

                if (statement.startsWith('@@id(')) {
                    model.compositeId = parseFieldList(statement);
                } else if (statement.startsWith('@@unique(')) {
                    model.uniqueGroups.push(parseFieldList(statement));
                } else if (statement.startsWith('@@index(')) {
                    model.indexes.push({ fields: parseFieldList(statement), unique: /unique:\s*true/.test(statement) });
                } else if (!statement.startsWith('//')) {
                    model.fields.push(parseField(statement));
                }
            }

            models.push(model);
        }
    }

    resolveRelationTargets(models);

    const enumNames = new Set(enums.map((entry) => entry.name));
    for (const model of models) {
        model.enums = [...new Set(model.fields.map((field) => field.type))].filter((type) => enumNames.has(type));
    }

    models.sort((a, b) => a.name.localeCompare(b.name));

    return { generator, datasource, models, enums, sourcePath, modelCount: models.length };
}

export function findModel(catalogue: SchemaCatalogue, name: string): SchemaModel | undefined {
    const normalized = name.trim().replace(/^["'`]|["'`]$/g, '');
    return catalogue.models.find((model) => model.name.toLowerCase() === normalized.toLowerCase());
}

let cachedCatalogue: SchemaCatalogue | null = null;
let cachedCatalogueMtimeMs = -1;

/** Locates `prisma/schema.prisma` from both `src/` (tsx) and `dist/` layouts. */
export function resolveSchemaPath(): string | null {
    const candidates = [
        path.resolve(process.cwd(), 'prisma', 'schema.prisma'),
        path.resolve(process.cwd(), '..', 'prisma', 'schema.prisma'),
        path.resolve(process.cwd(), '..', '..', 'prisma', 'schema.prisma')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Loads (and memoises per file mtime) the live schema catalogue. Returns `null`
 * when the schema file cannot be located — callers must report that honestly
 * rather than fabricating an empty schema.
 */
export function loadSchemaCatalogue(): SchemaCatalogue | null {
    const schemaPath = resolveSchemaPath();
    if (!schemaPath) return null;

    let mtimeMs: number;
    try {
        mtimeMs = fs.statSync(schemaPath).mtimeMs;
    } catch {
        return null;
    }
    if (cachedCatalogue && cachedCatalogueMtimeMs === mtimeMs) return cachedCatalogue;

    try {
        cachedCatalogue = parsePrismaSchema(fs.readFileSync(schemaPath, 'utf8'), schemaPath);
        cachedCatalogueMtimeMs = mtimeMs;
        return cachedCatalogue;
    } catch (err) {
        console.error('[MCP] Failed to parse prisma/schema.prisma:', err);
        return null;
    }
}

/** Test seam: drops the memoised catalogue. */
export function resetSchemaCatalogueCache(): void {
    cachedCatalogue = null;
    cachedCatalogueMtimeMs = -1;
}
