import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export interface CommandDefinition {
    name: string;
    title?: string;
    displayNames?: Partial<Record<'en' | 'id', string>>;
    category?: string;
    aliases?: string[];
    description: string;
    descriptionKey?: string;
    owner?: boolean;
    /**
     * Feature class used to resolve the ceiling from the subscriber's plan
     * (`TIER_LIMITS[*].featureLimits`). Commands that pass through
     * `CommandsHandler.execute()` only; agent-engine tools execute inside
     * `executor.ts` and are bounded by `AgentRateLimiter` instead.
     */
    limitKey?: 'sticker' | 'download' | 'stt';
    /**
     * Fallback limit when the user's plan does not configure `limitKey`.
     * Max invocations per `windowMs` per JID. A command must declare this to be
     * limited at all; commands that declare nothing are never throttled.
     */
    limit?: { max: number; windowMs: number };
    parameters?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
}

export interface CommandContext {
    sock: WASocket;
    msg: WAMessage;
    jid: string;
    t: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string;
    lang?: string;
    /**
     * The canonical dotted command name the message handler resolved for this
     * invocation (for example `.apply license`). Supplied by the handler so commands
     * never have to re-derive it from raw message text.
     */
    commandName?: string;
    /**
     * The argument string that followed the command name, already stripped of the
     * prefix and the command words. Commands should prefer this over slicing the raw
     * message text, which breaks on detached prefixes like ". menu".
     */
    argsStr?: string;
}

export interface CommandModule {
    definition: CommandDefinition;
    execute: (args: Record<string, any>, ctx: CommandContext) => Promise<string | null | undefined | void>;
}

// Backward-compatible aliases
export type ToolDefinition = CommandDefinition;
export type ToolContext = CommandContext;
export type ToolModule = CommandModule;
/**
 * Resolves the localized description of a tool using the provided translator function.
 * Falls back to conventional i18n keys or the default English description.
 */
export function resolveCommandDescription(
    def: Pick<CommandDefinition, 'name' | 'description' | 'descriptionKey'>,
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
export const resolveToolDescription = resolveCommandDescription;
