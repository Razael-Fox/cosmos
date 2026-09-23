import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../src');
const localesDir = path.join(srcDir, 'locales/id');

function getLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    let keys: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            keys = keys.concat(getLeafKeys(v as Record<string, unknown>, fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

function loadAllLocaleKeys(): Set<string> {
    const allKeys = new Set<string>();
    const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
        const namespace = file.replace('.json', '');
        const filePath = path.join(localesDir, file);
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
            const keys = getLeafKeys(content, namespace);
            for (const k of keys) {
                allKeys.add(k);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[check-i18n-usage] Failed to parse ${filePath}:`, msg);
        }
    }
    return allKeys;
}

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

interface KeyUsage {
    file: string;
    line: number;
    key: string;
}

function extractKeyUsages(filePath: string): KeyUsage[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const usages: KeyUsage[] = [];

    // Match static string calls: t('key'), ctx.t('key'), targetT('key'), etc., and descriptionKey: 'key'
    const keyRegex =
        /(?:\b(?:ctx\.)?t|descriptionKey:\s*)\(\s*['"]([a-zA-Z0-9_.-]+)['"]|descriptionKey:\s*['"]([a-zA-Z0-9_.-]+)['"]/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match: RegExpExecArray | null;
        while ((match = keyRegex.exec(line)) !== null) {
            const key = match[1] || match[2];
            if (key && key.includes('.')) {
                usages.push({
                    file: path.relative(path.resolve(__dirname, '..'), filePath),
                    line: i + 1,
                    key
                });
            }
        }
    }

    return usages;
}

function checkUsage(): boolean {
    console.log('[check-i18n-usage] Scanning source code for i18n key references...');
    const catalogKeys = loadAllLocaleKeys();
    const tsFiles = walkTsFiles(srcDir);

    let missingCount = 0;
    const missingUsages: KeyUsage[] = [];

    for (const file of tsFiles) {
        const usages = extractKeyUsages(file);
        for (const usage of usages) {
            if (!catalogKeys.has(usage.key)) {
                // Ignore dynamic patterns or test fixtures if any
                missingUsages.push(usage);
                missingCount++;
            }
        }
    }

    if (missingCount > 0) {
        console.error(`[check-i18n-usage] Found ${missingCount} key reference(s) missing from catalog:`);
        for (const m of missingUsages) {
            console.error(`  - ${m.file}:${m.line} -> "${m.key}"`);
        }
        return false;
    }

    console.log(`✓ [check-i18n-usage] All static key references in source files exist in translation catalog.`);
    return true;
}

const success = checkUsage();
if (!success) {
    process.exit(1);
}
