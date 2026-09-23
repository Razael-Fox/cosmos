import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.resolve(__dirname, '../src/locales');
const baseLanguage = 'id';
const targetLanguages = ['en'];

function getLeafEntries(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(entries, getLeafEntries(v, fullKey));
        } else {
            entries[fullKey] = String(v ?? '');
        }
    }
    return entries;
}

function extractVariables(text: string): string[] {
    const matches = text.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
    return [...new Set(matches.map((m) => m.replace(/[{}]/g, '').trim()))].sort();
}

function validateI18n(): boolean {
    console.log(`[i18n-validator] Validating translation files in: ${localesDir}`);
    const baseDir = path.join(localesDir, baseLanguage);

    if (!fs.existsSync(baseDir)) {
        console.error(`[i18n-validator] Base language directory not found: ${baseDir}`);
        return false;
    }

    const baseFiles = fs.readdirSync(baseDir).filter((f) => f.endsWith('.json'));
    let hasError = false;

    for (const file of baseFiles) {
        const baseFilePath = path.join(baseDir, file);
        let baseContent: Record<string, unknown>;
        try {
            baseContent = JSON.parse(fs.readFileSync(baseFilePath, 'utf-8'));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[i18n-validator] Failed to parse ${baseFilePath}:`, msg);
            hasError = true;
            continue;
        }

        const baseEntries = getLeafEntries(baseContent);
        const baseKeys = Object.keys(baseEntries);

        // Check for empty values in base language
        for (const [k, val] of Object.entries(baseEntries)) {
            if (!val.trim()) {
                console.error(`[i18n-validator] [${baseLanguage}/${file}] Empty value for key: ${k}`);
                hasError = true;
            }
        }

        for (const targetLang of targetLanguages) {
            const targetFilePath = path.join(localesDir, targetLang, file);
            if (!fs.existsSync(targetFilePath)) {
                console.error(`[i18n-validator] Missing translation file: ${targetFilePath}`);
                hasError = true;
                continue;
            }

            let targetContent: Record<string, unknown>;
            try {
                targetContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf-8'));
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[i18n-validator] Failed to parse ${targetFilePath}:`, msg);
                hasError = true;
                continue;
            }

            const targetEntries = getLeafEntries(targetContent);
            const targetKeys = Object.keys(targetEntries);

            const missingKeys = baseKeys.filter((k) => !targetKeys.includes(k));
            const extraKeys = targetKeys.filter((k) => !baseKeys.includes(k));

            if (missingKeys.length > 0) {
                console.error(
                    `[i18n-validator] [${targetLang}/${file}] Missing ${missingKeys.length} keys:\n  - ${missingKeys.join('\n  - ')}`
                );
                hasError = true;
            }

            if (extraKeys.length > 0) {
                console.error(
                    `[i18n-validator] [${targetLang}/${file}] Extra ${extraKeys.length} keys (not in ${baseLanguage}):\n  - ${extraKeys.join('\n  - ')}`
                );
                hasError = true;
            }

            // Check for empty values and variable set parity
            for (const key of baseKeys) {
                if (targetEntries[key] !== undefined) {
                    const targetVal = targetEntries[key];
                    if (!targetVal.trim()) {
                        console.error(`[i18n-validator] [${targetLang}/${file}] Empty value for key: ${key}`);
                        hasError = true;
                    }

                    const baseVars = extractVariables(baseEntries[key]);
                    const targetVars = extractVariables(targetVal);
                    if (baseVars.join(',') !== targetVars.join(',')) {
                        console.error(
                            `[i18n-validator] [${targetLang}/${file}] Variable mismatch for "${key}":\n  ${baseLanguage}: [${baseVars.join(', ')}]\n  ${targetLang}: [${targetVars.join(', ')}]`
                        );
                        hasError = true;
                    }
                }
            }
        }
    }

    if (!hasError) {
        console.log('✓ [i18n-validator] All translation keys, values, and interpolation variables are in sync.');
        return true;
    }
    return false;
}

const success = validateI18n();
if (!success) {
    process.exit(1);
}
