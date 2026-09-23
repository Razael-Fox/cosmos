/**
 * Command Formatting and Normalization Utilities.
 * Handles space-separated display normalization, localized parent command titles,
 * and legacy command deprecation mappings.
 */

export interface CommandDisplayHolder {
    name: string;
    displayNames?: Partial<Record<'en' | 'id', string>>;
}

/**
 * Normalizes command names into canonical space-separated display form.
 * Replaces consecutive hyphens and underscores with single spaces.
 */
export function toDisplayCommand(name: string): string {
    return name.replace(/[-_]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Resolves the localized display name for a command based on the resolved language.
 * Falls back to English canonical display name or the tool definition name.
 */
export function getDisplayName(tool: CommandDisplayHolder, lang: string = 'id'): string {
    const resolvedLang = (lang === 'en' ? 'en' : 'id') as 'en' | 'id';
    const localizedName = tool.displayNames?.[resolvedLang] ?? tool.displayNames?.en ?? tool.name;
    return toDisplayCommand(localizedName);
}

/**
 * Legacy command aliases that trigger deprecation notices.
 * Maps legacy trigger tokens (without leading dot) to their canonical space form.
 */
export const LEGACY_COMMAND_MAP: Record<string, string> = {
    'register-id': '.register id',
    registerid: '.register id',
    'check-id': '.check id',
    'apply-license': '.apply license',
    applylicense: '.apply license',
    'apply-job': '.apply job',
    applyjob: '.apply job'
};

/**
 * Determines whether a given command token is a legacy command and returns its canonical form.
 */
export function getLegacyCanonical(commandName: string): string | null {
    const clean = commandName.trim().replace(/^\./, '').toLowerCase();
    return LEGACY_COMMAND_MAP[clean] || null;
}
