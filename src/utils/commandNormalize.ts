/**
 * Canonical Command Normalization.
 *
 * A single source of truth for turning any user-supplied command string into a
 * canonical lookup key. The bot accepts commands with or without the leading
 * dot, with the dot detached by whitespace (`. menu`), with collapsed or
 * repeated whitespace, and with hyphens/underscores standing in for spaces
 * (`.apply-license` for `.apply license`).
 *
 * Every layer that resolves a command name (the message handler parser, the
 * tools registry, the menu service, the deprecation map) MUST normalize through
 * these helpers so a given logical command produces one identical key
 * regardless of how the user typed it.
 */

/**
 * Normalizes a raw command string into a canonical lookup key.
 *
 * - lowercases
 * - strips any leading dots and surrounding whitespace (`.menu`, `..menu`, `. menu`)
 * - collapses hyphens, underscores, and whitespace runs into single spaces
 *
 * Examples:
 *   `. menu`            -> `menu`
 *   `.MENU`             -> `menu`
 *   `.apply-license`    -> `apply license`
 *   `.  apply__license` -> `apply license`
 */
export function normalizeCommandKey(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw
        .toLowerCase()
        .replace(/^[.\s]+/, '')
        .replace(/[-_\s]+/g, ' ')
        .trim();
}

/**
 * Produces the fully stripped comparison form used as a last-resort fallback,
 * where spaces, hyphens, and underscores are all removed entirely.
 *
 * Examples: `.apply-license` -> `applylicense`, `. stiker brat` -> `stikerbrat`
 */
export function stripCommandKey(raw: string | null | undefined): string {
    return normalizeCommandKey(raw).replace(/\s+/g, '');
}

/**
 * Determines whether a message body is a command invocation for the given prefix.
 *
 * The prefix is matched at the very start of the (trimmed) text and may be
 * followed by arbitrary whitespace, so both `.menu` and `. menu` qualify.
 */
export function isCommandInvocation(text: string, activePrefix: string = '.'): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    const prefix = activePrefix || '.';
    return trimmed.startsWith(prefix) || trimmed.startsWith('.');
}

/**
 * Splits a command body into its prefix and the remaining command text.
 * Returns the prefix that was actually matched and the residual text with the
 * prefix removed, so callers can re-attach it uniformly.
 *
 * The active prefix is matched first for exactness. Failing that, any leading
 * run of non-alphanumeric characters is treated as the prefix, so tools that
 * render messages for sub-bots with custom prefixes (for example `!`) can still
 * tokenize correctly without knowing which prefix is in force.
 */
export function splitCommandPrefix(text: string, activePrefix: string = '.'): { prefix: string; body: string } {
    const trimmed = (text || '').trim();
    const prefix = activePrefix || '.';

    if (prefix !== '.' && trimmed.startsWith(prefix)) {
        return { prefix, body: trimmed.slice(prefix.length).trim() };
    }
    if (trimmed.startsWith('.')) {
        return { prefix: '.', body: trimmed.slice(1).trim() };
    }

    // Generic fallback: a leading punctuation run acting as a command prefix.
    const generic = trimmed.match(/^([^\p{L}\p{N}]+)\s*([\s\S]*)$/u);
    if (generic) {
        return { prefix: generic[1], body: (generic[2] || '').trim() };
    }

    return { prefix, body: trimmed };
}

/**
 * The maximum number of whitespace-separated words any registered command name
 * or alias may contain. The message handler uses this to bound its greedy
 * longest-prefix scan instead of hardcoding a small constant.
 */
export const MAX_COMMAND_WORDS = 5;

/**
 * Commands that are intercepted and handled inline by the message handler
 * rather than dispatched through the tools registry (for example the group
 * whitelist add/remove flows, which manage their own quota and ownership rules).
 *
 * They are kept separate from tool aliases on purpose: other subsystems such as
 * the auto-download resolver use `ToolsHandler.getTool()` to decide whether a
 * command is dispatchable, and these commands are not.
 */
export const INLINE_COMMAND_KEYS: ReadonlySet<string> = new Set([
    'addgroup',
    'addwhitelist',
    'group add',
    'delgroup',
    'removewhitelist',
    'group del'
]);

/**
 * True when a canonical command key is handled inline by the message handler.
 */
export function isInlineCommand(raw: string | null | undefined): boolean {
    return INLINE_COMMAND_KEYS.has(normalizeCommandKey(raw));
}

/**
 * Extracts the words that a command was invoked with, prefixed or not.
 *
 * Tools historically re-derived the command words by splitting the raw message
 * text and slicing at a fixed index, which silently misparses a detached prefix
 * (". menu economy" yields `["", "menu", "economy"]` as far as index-based
 * consumers are concerned). This helper strips the prefix first, so the returned
 * words always begin with the actual command name.
 */
export function getCommandWords(rawText: string, activePrefix: string = '.'): string[] {
    const { body } = splitCommandPrefix(rawText || '', activePrefix);
    if (!body) return [];
    return body.split(/\s+/).filter(Boolean);
}
