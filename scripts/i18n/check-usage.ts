import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../../src');
const localesDir = path.join(srcDir, 'locales/id');

// ── Catalogue ────────────────────────────────────────────────────────────────────

interface Catalog {
    keys: Set<string>;
    /** key -> the `{{variable}}` names that key's template interpolates */
    variables: Map<string, Set<string>>;
}

function collectTemplateVariables(value: string): Set<string> {
    const vars = new Set<string>();
    const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(value)) !== null) {
        vars.add(m[1]);
    }
    return vars;
}

function loadCatalog(): Catalog {
    const keys = new Set<string>();
    const variables = new Map<string, Set<string>>();
    const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));

    const walk = (obj: Record<string, unknown>, prefix: string): void => {
        for (const [k, v] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                walk(v as Record<string, unknown>, fullKey);
            } else {
                keys.add(fullKey);
                if (typeof v === 'string') {
                    variables.set(fullKey, collectTemplateVariables(v));
                }
            }
        }
    };

    for (const file of files) {
        const namespace = file.replace('.json', '');
        const filePath = path.join(localesDir, file);
        try {
            walk(JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>, namespace);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[check-i18n-usage] Failed to parse ${filePath}:`, msg);
        }
    }

    return { keys, variables };
}

// ── Source scanning ──────────────────────────────────────────────────────────────

function walkTsFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });

    for (const dirent of list) {
        const fullPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
            if (dirent.name === 'locales' || dirent.name === 'node_modules') continue;
            results = results.concat(walkTsFiles(fullPath));
        } else if (dirent.isFile() && dirent.name.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

/** Advances past a string literal starting at `i` (which must be a quote char). */
function skipString(text: string, i: number): number {
    const quote = text[i];
    let j = i + 1;
    while (j < text.length) {
        if (text[j] === '\\') {
            j += 2;
            continue;
        }
        if (text[j] === quote) return j + 1;
        j++;
    }
    return text.length;
}

/**
 * Advances past a template literal, honouring `${ ... }` interpolation so that a
 * translator call nested inside an interpolation is still matched by the caller.
 * Returns the index just past the closing backtick.
 */
function skipTemplate(text: string, i: number): number {
    let j = i + 1;
    while (j < text.length) {
        if (text[j] === '\\') {
            j += 2;
            continue;
        }
        if (text[j] === '`') return j + 1;
        if (text[j] === '$' && text[j + 1] === '{') {
            // Skip the interpolation expression, tracking nested braces and strings.
            let depth = 1;
            j += 2;
            while (j < text.length && depth > 0) {
                const ch = text[j];
                if (ch === '"' || ch === "'") {
                    j = skipString(text, j);
                    continue;
                }
                if (ch === '`') {
                    j = skipTemplate(text, j);
                    continue;
                }
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                j++;
            }
            continue;
        }
        j++;
    }
    return text.length;
}

/**
 * Extracts the top-level property names of the object literal that supplies a
 * translator call's interpolation variables.
 *
 * Walks the literal with balanced-delimiter tracking so that nested calls, nested
 * objects, arrays, and string values are stepped over rather than mistaken for
 * property names — e.g. `{ error: explainStatus(t, r.message) }` yields `{error}`.
 *
 * Returns null when no object literal is supplied, or when the literal contains
 * syntax that cannot be statically resolved (spread `...x`, computed `[k]:`, or a
 * bare identifier whose meaning is unknown). Such call sites are skipped rather than
 * reported, so the check never produces a false positive.
 */
function extractSuppliedVariables(text: string, fromIndex: number): Set<string> | null {
    // `fromIndex` sits just past the key's closing quote. Allow only whitespace and a
    // single separating comma before the optional object literal, so a `{` belonging to
    // an enclosing expression (`t('k'), { other: 1 }`) is never mistaken for argument 2.
    let i = fromIndex;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === ',') {
        i++;
        while (i < text.length && /\s/.test(text[i])) i++;
    }
    if (i >= text.length || text[i] !== '{') return null;

    const supplied = new Set<string>();
    let depth = 0;
    let expectingKey = true;

    for (let j = i; j < text.length; j++) {
        const ch = text[j];

        if (ch === '"' || ch === "'") {
            // At a key position a quoted string may be a quoted property key
            // (e.g. `{ 'target': target }`). Only treat it as a key when a colon
            // actually follows; otherwise it is a string value and we skip it.
            const strEnd = skipString(text, j);
            if (depth === 1 && expectingKey) {
                const quotedKey = /^(['"])(.*?)\1\s*:/.exec(text.slice(strEnd));
                if (quotedKey) {
                    supplied.add(quotedKey[2]);
                    j = strEnd - 1;
                    expectingKey = false;
                    continue;
                }
                return null; // unresolvable: a quoted token where a key is expected
            }
            j = strEnd - 1;
            expectingKey = false;
            continue;
        }
        if (ch === '`') {
            j = skipTemplate(text, j) - 1;
            expectingKey = false;
            continue;
        }
        if (ch === '(' || ch === '[') {
            // Skip the whole parenthesised / bracketed value.
            const open = ch;
            const close = open === '(' ? ')' : ']';
            let d = 0;
            while (j < text.length) {
                const c = text[j];
                if (c === '"' || c === "'") {
                    j = skipString(text, j) - 1;
                } else if (c === '`') {
                    j = skipTemplate(text, j) - 1;
                } else if (c === open) d++;
                else if (c === close) {
                    d--;
                    if (d === 0) break;
                }
                j++;
            }
            expectingKey = false;
            continue;
        }
        if (ch === '{') {
            depth++;
            if (depth === 1) {
                expectingKey = true;
                continue;
            }
            expectingKey = false;
            continue;
        }
        if (ch === '}') {
            depth--;
            if (depth === 0) break;
            expectingKey = false;
            continue;
        }
        if (ch === ',') {
            expectingKey = depth === 1;
            continue;
        }
        if (/\s/.test(ch)) continue;

        // Any other character while depth === 1 means we are at a property position.
        if (depth === 1 && expectingKey) {
            if (ch === '.' || ch === '[') return null; // spread or computed key
            const prop = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(text.slice(j));
            if (prop) {
                supplied.add(prop[1]);
                j += prop[0].length - 1;
                expectingKey = false;
                continue;
            }
            const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(j));
            if (ident) {
                const after = text.slice(j + ident[0].length);
                if (/^\s*[},]/.test(after)) {
                    // Shorthand `{ phone }`.
                    supplied.add(ident[0]);
                    j += ident[0].length - 1;
                    expectingKey = false;
                    continue;
                }
                return null; // unresolvable value position
            }
            return null;
        }
    }

    if (depth !== 0) return null;
    return supplied;
}

interface KeyUsage {
    file: string;
    line: number;
    key: string;
    /** null when no statically-resolvable object literal accompanies the call */
    suppliedVariables: Set<string> | null;
}

/**
 * Blanks out comments while preserving every byte offset, so matches stay aligned with
 * the original source and `content.slice(0, match.index)` still reports the right line.
 *
 * Needed because the scanner is regex-based: a doc comment like ``t('...')`` describing
 * the very syntax being matched reads as a real call and reports a bogus missing key.
 * String and template literals are preserved, since a key legitimately lives inside one.
 *
 * ponytail: a small hand-rolled scanner, not a full tokenizer. It only has to get
 * comments right; regex literals containing quotes are the known ceiling, and this
 * script does not parse TypeScript expressions.
 */
function maskComments(content: string): string {
    const out = content.split('');
    let i = 0;
    // Tracks the quote delimiter of the string literal we are inside, or null in code.
    let inString: '"' | "'" | '`' | null = null;

    while (i < content.length) {
        const ch = content[i] as string;
        const next = content[i + 1] as string | undefined;

        if (inString) {
            if (ch === '\\') {
                i += 2; // Preserve the escape pair verbatim.
                continue;
            }
            if (ch === inString) inString = null;
            i++;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
            i++;
            continue;
        }

        if (ch === '/' && next === '/') {
            while (i < content.length && content[i] !== '\n') {
                out[i] = ' ';
                i++;
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
                if (content[i] !== '\n') out[i] = ' ';
                i++;
            }
            if (i < content.length) {
                out[i] = ' '; // '*'
                out[i + 1] = ' '; // '/'
                i += 2;
            }
            continue;
        }

        i++;
    }

    return out.join('');
}

function extractKeyUsages(filePath: string): KeyUsage[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Line numbers are computed from `raw` so they point at the real source; matching
    // runs against the masked copy so comments cannot fabricate key references.
    const content = maskComments(raw);
    const usages: KeyUsage[] = [];
    const relativePath = path.relative(path.resolve(__dirname, '../..'), filePath);

    // Match static string calls: t('key'), ctx.t('key'), targetT('key'), etc., and descriptionKey: 'key'
    const keyRegex =
        /(?:\b(?:ctx\.)?t|descriptionKey:\s*)\(\s*['"]([a-zA-Z0-9_.-]+)['"]|descriptionKey:\s*['"]([a-zA-Z0-9_.-]+)['"]/g;

    // The regex runs over the whole file rather than line-by-line, because the object
    // literal supplying a template's variables frequently spans multiple lines.
    // `match.index` is therefore an absolute offset into `content`.
    let match: RegExpExecArray | null;
    while ((match = keyRegex.exec(content)) !== null) {
        const key = match[1] || match[2];
        if (!key || !key.includes('.')) continue;

        usages.push({
            file: relativePath,
            line: raw.slice(0, match.index).split('\n').length,
            key,
            suppliedVariables: extractSuppliedVariables(content, match.index + match[0].length)
        });
    }

    return usages;
}

// ── Checks ───────────────────────────────────────────────────────────────────────

interface InterpolationGap {
    file: string;
    line: number;
    key: string;
    missing: string[];
}

/**
 * A template that interpolates `{{vars}}` must be given those variables at every call
 * site. When one is absent, i18next silently emits the raw placeholder to the end user,
 * so this class of defect is invisible to a catalogue-parity check.
 */
function findInterpolationGaps(catalog: Catalog, tsFiles: string[]): InterpolationGap[] {
    const gaps: InterpolationGap[] = [];

    for (const file of tsFiles) {
        for (const usage of extractKeyUsages(file)) {
            const required = catalog.variables.get(usage.key);
            if (!required || required.size === 0 || usage.suppliedVariables === null) continue;

            const missing = [...required].filter((v) => !usage.suppliedVariables!.has(v));
            if (missing.length > 0) {
                gaps.push({ file: usage.file, line: usage.line, key: usage.key, missing });
            }
        }
    }

    return gaps;
}

function checkUsage(): boolean {
    console.log('[check-i18n-usage] Scanning source code for i18n key references...');
    const catalog = loadCatalog();
    const tsFiles = walkTsFiles(srcDir);

    const missingKeys: KeyUsage[] = [];
    for (const file of tsFiles) {
        for (const usage of extractKeyUsages(file)) {
            if (!catalog.keys.has(usage.key)) missingKeys.push(usage);
        }
    }

    let ok = true;

    if (missingKeys.length > 0) {
        ok = false;
        console.error(`[check-i18n-usage] Found ${missingKeys.length} key reference(s) missing from catalog:`);
        for (const m of missingKeys) {
            console.error(`  - ${m.file}:${m.line} -> "${m.key}"`);
        }
    }

    const gaps = findInterpolationGaps(catalog, tsFiles);
    if (gaps.length > 0) {
        ok = false;
        console.error(
            `[check-i18n-usage] Found ${gaps.length} call site(s) missing interpolation argument(s) ` +
                '(these render as raw {{placeholders}} to end users):'
        );
        for (const g of gaps) {
            console.error(`  - ${g.file}:${g.line} -> "${g.key}" is missing: ${g.missing.join(', ')}`);
        }
    }

    if (!ok) return false;

    console.log(
        '✓ [check-i18n-usage] All static key references in source files exist in translation catalog, ' +
            'and every call site supplies the variables its template interpolates.'
    );
    return true;
}

if (!checkUsage()) {
    process.exit(1);
}
