import { i18n, reloadI18n, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../locales/i18n.config.js';
import { prisma } from '../db.js';

export { SUPPORTED_LANGUAGES };
export type { SupportedLanguage };

export const LANGUAGE_CONFIG: Record<SupportedLanguage, { nativeName: string; direction: 'ltr' | 'rtl' }> = {
    id: { nativeName: 'Bahasa Indonesia', direction: 'ltr' },
    en: { nativeName: 'English', direction: 'ltr' }
};

export function isRTL(lang: string): boolean {
    const norm = normalizeLanguage(lang);
    return LANGUAGE_CONFIG[norm]?.direction === 'rtl';
}

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
    if (!lang) return 'id';
    const lower = String(lang).trim().toLowerCase();
    if (lower === 'id' || lower === 'indonesian' || lower === 'indonesia') return 'id';
    if (lower === 'en' || lower === 'english') return 'en';
    return 'id';
}

export function getTranslator(
    lang: string
): (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string {
    const finalLang = normalizeLanguage(lang);

    return (
        key: string,
        variablesOrFallback?: Record<string, any> | string,
        variables?: Record<string, any>
    ): string => {
        let vars: Record<string, any> | undefined;
        let fallback: string | undefined;

        if (typeof variablesOrFallback === 'string') {
            fallback = variablesOrFallback;
            vars = variables;
        } else {
            vars = variablesOrFallback;
        }

        if (i18n.exists(key, { lng: finalLang })) {
            return i18n.t(key, { lng: finalLang, ...vars });
        }

        // If key not found in finalLang, try fallback to 'id' if not already 'id'
        if (finalLang !== 'id' && i18n.exists(key, { lng: 'id' })) {
            return i18n.t(key, { lng: 'id', ...vars });
        }

        if (fallback !== undefined) {
            return fallback;
        }

        // If still not found, handle missing key
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`[i18n] Missing translation key "${key}" for language "${finalLang}"`);
        }
        return key;
    };
}

export async function getItemWithTranslation(itemId: string | number, lang: string) {
    const item = await prisma.item.findFirst({
        where: {
            OR: [{ id: String(itemId) }, { shortId: String(itemId) }]
        }
    });
    if (!item) return null;

    const t = getTranslator(lang);
    const key = `tools.items.${item.shortId}`;
    const translatedName = t(`${key}.name`);
    const translatedDesc = t(`${key}.description`);

    return {
        ...item,
        name: translatedName !== `${key}.name` ? translatedName : item.name,
        description: translatedDesc !== `${key}.description` ? translatedDesc : item.description
    };
}

export async function getChatLanguage(chatJid: string): Promise<string> {
    try {
        if (chatJid.endsWith('@g.us')) {
            const group = await prisma.whitelistedGroup.findUnique({ where: { jid: chatJid } });
            if (group?.language) {
                return normalizeLanguage(group.language);
            }
        } else {
            const user = await prisma.user.findFirst({
                where: {
                    OR: [{ id: chatJid }, { lid: chatJid }]
                }
            });
            if (user?.language) {
                return normalizeLanguage(user.language);
            }
        }
    } catch {
        /* fallback to id */
    }
    return 'id';
}

export function reloadTranslations(): void {
    reloadI18n();
}
