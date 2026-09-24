import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export interface ToolDefinition {
    name: string;
    title?: string;
    displayNames?: Partial<Record<'en' | 'id', string>>;
    category?: string;
    aliases?: string[];
    description: string;
    descriptionKey?: string;
    owner?: boolean;
    parameters?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
}

export interface ToolContext {
    sock: WASocket;
    msg: WAMessage;
    jid: string;
    t: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string;
    lang?: string;
}

export interface ToolModule {
    definition: ToolDefinition;
    execute: (args: Record<string, any>, ctx: ToolContext) => Promise<string | null | undefined | void>;
}

/**
 * Resolves the localized description of a tool using the provided translator function.
 * Falls back to conventional i18n keys or the default English description.
 */
export function resolveToolDescription(
    def: Pick<ToolDefinition, 'name' | 'description' | 'descriptionKey'>,
    t?: (key: string, args?: Record<string, any>) => string
): string {
    if (!t) return def.description;

    // 1. Try explicit descriptionKey
    if (def.descriptionKey) {
        const translated = t(def.descriptionKey);
        if (translated && translated !== def.descriptionKey) {
            return translated;
        }
    }

    // 2. Try conventional tools.commands.<cleanName>.description
    const cleanName = def.name.replace(/^\./, '').replace(/[-\s]+/g, '_');
    const commandKey = `tools.commands.${cleanName}.description`;
    const translatedCommand = t(commandKey);
    if (translatedCommand && translatedCommand !== commandKey) {
        return translatedCommand;
    }

    // 3. Try legacy tools.<cleanName>.description
    const legacyKey = `tools.${cleanName}.description`;
    const translatedLegacy = t(legacyKey);
    if (translatedLegacy && translatedLegacy !== legacyKey) {
        return translatedLegacy;
    }

    // 4. Default fallback
    return def.description;
}
