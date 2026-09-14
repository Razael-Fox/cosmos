import fs from 'fs';
import path from 'path';
import i18next, { i18n as I18nInstance } from 'i18next';

export const NAMESPACES = ['core', 'tools', 'games', 'media', 'utilities'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const SUPPORTED_LANGUAGES = ['id', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function getLocalesDir(): string {
    const distPath = path.resolve(process.cwd(), 'dist', 'locales');
    const srcPath = path.resolve(process.cwd(), 'src', 'locales');
    if (fs.existsSync(path.join(srcPath, 'id', 'core.json'))) return srcPath;
    if (fs.existsSync(path.join(distPath, 'id', 'core.json'))) return distPath;
    if (fs.existsSync(srcPath)) return srcPath;
    return distPath;
}

export function loadResources(): Record<string, Record<string, any>> {
    const localesDir = getLocalesDir();
    const resources: Record<string, Record<string, any>> = {};

    for (const lang of SUPPORTED_LANGUAGES) {
        resources[lang] = {};
        for (const ns of NAMESPACES) {
            const filePath = path.join(localesDir, lang, `${ns}.json`);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    resources[lang][ns] = JSON.parse(content);
                } catch (err) {
                    console.error(`[i18n] Failed to parse ${filePath}:`, err);
                    resources[lang][ns] = {};
                }
            } else {
                resources[lang][ns] = {};
            }
        }
    }
    return resources;
}

export const i18n: I18nInstance = i18next.createInstance();

let initialized = false;

export function initI18n(): I18nInstance {
    if (!initialized) {
        const resources = loadResources();
        i18n.init({
            resources,
            fallbackLng: 'id',
            supportedLngs: [...SUPPORTED_LANGUAGES],
            ns: [...NAMESPACES],
            defaultNS: 'core',
            interpolation: {
                escapeValue: false
            },
            keySeparator: '.',
            nsSeparator: '.'
        });
        initialized = true;
    }
    return i18n;
}

export function reloadI18n(): void {
    const resources = loadResources();
    for (const lang of SUPPORTED_LANGUAGES) {
        for (const ns of NAMESPACES) {
            i18n.addResourceBundle(lang, ns, resources[lang][ns] || {}, true, true);
        }
    }
}

// Pre-initialize on module import
initI18n();
