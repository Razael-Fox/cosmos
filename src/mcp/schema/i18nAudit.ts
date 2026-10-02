/**
 * Cosmos MCP Server — i18n parity audit.
 *
 * AGENTS.md Rule O requires symmetric translation registration and forbids
 * `i18n.exists()`-style detection from being a manual chore. `cosmos_i18n_check`
 * performs the detection as a tool call: it diffs `src/locales/en` against
 * `src/locales/id`, reports missing keys per language, and reports keys that are
 * registered in neither language.
 */
import fs from 'fs';
import path from 'path';
import { getLocalesDir, NAMESPACES, SUPPORTED_LANGUAGES } from '#locales/i18n.config.js';

export interface LocaleNamespaceReport {
    namespace: string;
    /** Keys present in English but absent in Indonesian. */
    missingInId: string[];
    /** Keys present in Indonesian but absent in English. */
    missingInEn: string[];
    /** Keys present in neither language. */
    unused: string[];
    /** `true` when the namespace file exists for every supported language. */
    filesPresent: boolean;
    /** Interpolation variables that differ between the two languages. */
    variableMismatches: Array<{ key: string; onlyIn: string[] }>;
}

export interface I18nCheckReport {
    localesDir: string;
    languages: string[];
    namespaces: string[];
    /** `true` when every namespace is symmetric across every language. */
    pass: boolean;
    totalKeys: number;
    reports: LocaleNamespaceReport[];
    summary: string;
}

/** Flattens a nested JSON object into `a.b.c` leaf keys. */
function flatten(source: unknown, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        if (prefix) out.set(prefix, String(source ?? ''));
        return out;
    }
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [nestedKey, nestedValue] of flatten(value, fullKey)) {
                out.set(nestedKey, nestedValue);
            }
        } else {
            out.set(fullKey, String(value ?? ''));
        }
    }
    return out;
}

function readLocaleFile(localesDir: string, language: string, namespace: string): Map<string, string> | null {
    const filePath = path.join(localesDir, language, `${namespace}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
        return flatten(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (err) {
        console.error(`[MCP] Failed to parse ${filePath}:`, err);
        return null;
    }
}

function variablesOf(value: string): string[] {
    const matches = value.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
    return [...new Set(matches.map((entry) => entry.replace(/[{}]/g, '').trim()))].sort();
}

/** Runs the Rule O translation parity audit. */
export function runI18nCheck(): I18nCheckReport {
    const localesDir = getLocalesDir();
    const reports: LocaleNamespaceReport[] = [];
    let totalKeys = 0;

    for (const namespace of NAMESPACES) {
        const en = readLocaleFile(localesDir, 'en', namespace);
        const id = readLocaleFile(localesDir, 'id', namespace);
        const filesPresent = en !== null && id !== null;

        const enKeys = en ?? new Map<string, string>();
        const idKeys = id ?? new Map<string, string>();
        totalKeys += new Set<string>([...enKeys.keys(), ...idKeys.keys()]).size;

        const missingInId = [...enKeys.keys()].filter((key) => !idKeys.has(key)).sort();
        const missingInEn = [...idKeys.keys()].filter((key) => !enKeys.has(key)).sort();
        const union = new Set<string>([...enKeys.keys(), ...idKeys.keys()]);

        // Usage scan: a key is "unused" only when no source file references it in
        // any `t('...')` / `ctx.t('...')` / `'namespace.key'` form.
        const unused: string[] = [];
        for (const key of union) {
            if (!isKeyReferenced(key, namespace, localesDir)) unused.push(key);
        }

        const variableMismatches: LocaleNamespaceReport['variableMismatches'] = [];
        for (const key of union) {
            const enValue = enKeys.get(key);
            const idValue = idKeys.get(key);
            if (enValue === undefined || idValue === undefined) continue;
            const enVars = variablesOf(enValue);
            const idVars = variablesOf(idValue);
            const onlyIn: string[] = [];
            for (const variable of enVars) if (!idVars.includes(variable)) onlyIn.push(`${variable} (en only)`);
            for (const variable of idVars) if (!enVars.includes(variable)) onlyIn.push(`${variable} (id only)`);
            if (onlyIn.length > 0) variableMismatches.push({ key, onlyIn });
        }

        reports.push({
            namespace,
            missingInId,
            missingInEn,
            unused: unused.sort(),
            filesPresent,
            variableMismatches
        });
    }

    const pass = reports.every(
        (report) =>
            report.filesPresent &&
            report.missingInId.length === 0 &&
            report.missingInEn.length === 0 &&
            report.variableMismatches.length === 0
    );

    const missing = reports.reduce((total, report) => total + report.missingInId.length + report.missingInEn.length, 0);

    return {
        localesDir,
        languages: [...SUPPORTED_LANGUAGES],
        namespaces: [...NAMESPACES],
        pass,
        totalKeys,
        reports,
        summary: pass
            ? `All ${NAMESPACES.length} namespaces are symmetric across ${SUPPORTED_LANGUAGES.join(' and ')} (${totalKeys} keys).`
            : `${missing} translation key(s) are missing across ${NAMESPACES.length} namespace(s).`
    };
}

/** Cached flattened source corpus used for the usage scan. */
let sourceCorpus: { key: string; text: string } | null = null;

function loadSourceCorpus(): { key: string; text: string } {
    if (sourceCorpus) return sourceCorpus;
    const roots = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'dist')];
    const chunks: string[] = [];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        collectTsFiles(root, chunks);
        if (chunks.length > 0) break;
    }
    sourceCorpus = { key: chunks.join('\n'), text: chunks.join('\n') };
    return sourceCorpus;
}

function collectTsFiles(dir: string, out: string[], depth = 0): void {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectTsFiles(full, out, depth + 1);
        } else if (/\.(ts|js|mts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            try {
                out.push(fs.readFileSync(full, 'utf8'));
            } catch {
                /* ignore unreadable file */
            }
        }
    }
}

/** Cheap containment test for `namespace.key` or the `key` leaf in the corpus. */
function isKeyReferenced(key: string, namespace: string, localesDir: string): boolean {
    void localesDir;
    const corpus = loadSourceCorpus().text;
    if (!corpus) return false;
    if (corpus.includes(`'${key}'`) || corpus.includes(`"${key}"`) || corpus.includes(`\`${key}\``)) return true;
    // Command descriptions are generated from the tool name, so also accept the
    // leaf key of the `tools.commands.<name>.description` convention.
    const leaf = key.split('.').pop() || key;
    return leaf.length > 2 && (corpus.includes(`'${leaf}'`) || corpus.includes(`"${leaf}"`)) && namespace === 'tools';
}

/** Test seam: drops the cached source corpus. */
export function resetI18nCorpusCache(): void {
    sourceCorpus = null;
}
