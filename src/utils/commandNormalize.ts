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
 * Only two prefix forms are recognised, and both must be *known*:
 *
 *  1. the active prefix (Rule M fixes this to `.` for the main bot, sub-bots may
 *     use another character), and
 *  2. a leading run of one or more dots.
 *
 * An unknown leading punctuation character is **never** treated as a prefix
 * unless the caller explicitly opts in with `allowUnknownPrefix`. Several tools
 * feed raw captions and free text through this helper, where `#promo`,
 * `- 5 item`, or an emoji are ordinary content; stripping those characters
 * silently shifts every positional index the caller reads.
 *
 * The opt-in is defensive rather than load-bearing: no `src/` caller passes it
 * today. Sub-bot prefixes are already handled correctly because the message
 * handler passes the active prefix explicitly, and every tool reads the
 * handler-resolved envelope before falling back to raw tokenization. It exists
 * so that a future caller which genuinely cannot know the prefix in force has a
 * supported way to ask for the old lenient behaviour instead of reintroducing a
 * bespoke prefix-stripping regex.
 *
 * The whole leading dot run is consumed, so `...selamat` yields `selamat`
 * rather than the inconsistent `..selamat` produced by consuming one dot.
 */
export function splitCommandPrefix(
    text: string,
    activePrefix: string = '.',
    options: { allowUnknownPrefix?: boolean } = {}
): { prefix: string; body: string } {
    const trimmed = (text || '').trim();
    const prefix = activePrefix || '.';

    if (prefix !== '.' && trimmed.startsWith(prefix)) {
        return { prefix, body: trimmed.slice(prefix.length).trim() };
    }

    const dotRun = trimmed.match(/^\.+/);
    if (dotRun) {
        return { prefix: dotRun[0], body: trimmed.slice(dotRun[0].length).trim() };
    }

    if (options.allowUnknownPrefix) {
        // Opt-in: a leading run of one repeated non-alphanumeric character
        // (`!`, `#`, `/`, ...) acting as a prefix. Hyphens and underscores are
        // excluded because this codebase uses them as word separators inside
        // command names (`.apply-license`).
        const generic = trimmed.match(/^([^\p{L}\p{N}\s_-])(?:[^\p{L}\p{N}\s_-]*)\s*([\s\S]*)$/u);
        if (generic) {
            return { prefix: generic[1], body: (generic[2] || '').trim() };
        }
    }

    return { prefix: '', body: trimmed };
}

/**
 * The expected ceiling on how many whitespace-separated words any registered
 * command name or alias contains, used to bound the message handler's greedy
 * longest-prefix scan.
 *
 * This is deliberately *not* a clamp on the discovered vocabulary: the registry
 * reports its true maximum through `ToolsHandler.getMaxCommandWords()`, and the
 * handler warns when that maximum exceeds this expectation. Truncating the
 * vocabulary instead would make an over-long command silently unreachable, with
 * no diagnostic anywhere.
 */
export const MAX_COMMAND_WORDS = 5;

/**
 * Commands that whitelist the current group, handled inline by the message
 * handler rather than dispatched through the tools registry (the flow manages
 * its own quota, ownership, and idempotency rules).
 *
 * Spaced spellings are listed explicitly rather than relying on the registry:
 * `normalizeCommandKey` maps `.add-whitelist` to `add whitelist`, so a
 * hyphenated or spaced user input produces the spaced key, never `addwhitelist`.
 * Omitting them made `.add whitelist` parse to `.add`, match no tool, and
 * silently do nothing.
 *
 * They are kept separate from tool aliases on purpose: other subsystems such as
 * the auto-download resolver use `ToolsHandler.getTool()` to decide whether a
 * command is dispatchable, and these commands are not.
 */
export const INLINE_ADD_COMMAND_KEYS: ReadonlySet<string> = new Set([
    'addgroup',
    'addwhitelist',
    'add group',
    'add whitelist',
    'group add'
]);

/** Inline commands that remove the current group from the whitelist. */
export const INLINE_REMOVE_COMMAND_KEYS: ReadonlySet<string> = new Set([
    'delgroup',
    'del group',
    'removewhitelist',
    'remove whitelist',
    'group del'
]);

/** Every inline-handled command, used to bound the parser's longest-prefix scan. */
export const INLINE_COMMAND_KEYS: ReadonlySet<string> = new Set([
    ...INLINE_ADD_COMMAND_KEYS,
    ...INLINE_REMOVE_COMMAND_KEYS
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
 *
 * Pass `allowUnknownPrefix` only when the text is known to be a command
 * invocation; see `splitCommandPrefix` for why unknown punctuation is not
 * stripped by default.
 */
export function getCommandWords(
    rawText: string,
    activePrefix: string = '.',
    options: { allowUnknownPrefix?: boolean } = {}
): string[] {
    const { body } = splitCommandPrefix(rawText || '', activePrefix, options);
    if (!body) return [];
    return body.split(/\s+/).filter(Boolean);
}

/**
 * Returns the argument remainder of a command body after the first
 * `consumedWords` whitespace-separated words, **preserving the original bytes**
 * of everything that follows.
 *
 * This exists because re-joining split tokens with a single space (`join(' ')`)
 * destroys every internal whitespace run, which corrupts free-text arguments for
 * every single-parameter tool — most visibly monospace payloads, whose whole
 * purpose under Rule AC is to carry user text exactly. Slicing the original
 * string keeps `halo     dunia` and `` `John  Doe` `` intact.
 *
 * Leading and trailing whitespace of the remainder is trimmed, matching the
 * pre-normalization parser, so callers see the same envelope they always did.
 */
export function sliceArgsAfterWords(body: string, consumedWords: number): string {
    const text = body || '';
    if (consumedWords <= 0) return text.trim();

    let end = 0;
    let seen = 0;
    const wordPattern = /\S+/g;
    let match: RegExpExecArray | null;
    while (seen < consumedWords && (match = wordPattern.exec(text)) !== null) {
        end = match.index + match[0].length;
        seen += 1;
    }
    if (seen < consumedWords) return '';
    return text.slice(end).trim();
}

/**
 * The argument envelope the message handler already resolved for a tool call.
 *
 * `commandName` is the canonical command that matched (for example `.bank
 * deposit`), and `argsStr` is the verbatim remainder of the original message.
 * Tools MUST prefer these over re-deriving tokens from the raw message text:
 * the handler performs the prefix split and the greedy longest-prefix match once,
 * and re-deriving it per tool is what previously let each layer disagree about
 * where the command ends and the arguments begin.
 */
export interface ResolvedCommandArgs {
    /** Canonical lookup key of the matched command, for example `bank deposit`. */
    commandKey: string;
    /** First word of the argument remainder, lowercased. Empty when there are none. */
    subcommand: string;
    /** The remainder after `subcommand`, preserving the original bytes. */
    rest: string;
    /** The full argument remainder, preserving the original bytes. */
    args: string;
}

/**
 * Derives the command key, subcommand, and byte-faithful remainder from the
 * fields the handler placed on `ToolContext`.
 *
 * When either field is missing — a tool invoked directly from a test or another
 * code path rather than through the message handler — the caller should fall back
 * to `getCommandWords` on the raw text. This helper therefore never guesses: it
 * only reports what it was given.
 */
export function resolveCommandArgs(
    commandName: string | null | undefined,
    argsStr: string | null | undefined
): ResolvedCommandArgs {
    const commandKey = normalizeCommandKey(commandName);
    const args = typeof argsStr === 'string' ? argsStr.trim() : '';
    const subcommand = (args.match(/^\S+/)?.[0] ?? '').toLowerCase();
    return {
        commandKey,
        subcommand,
        rest: subcommand ? sliceArgsAfterWords(args, 1) : args,
        args
    };
}

/**
 * Builds the token array a tool reads its subcommand and payload from.
 *
 * All seven tools that used to re-derive this independently need the exact same
 * shape, and when they each built it by hand they drifted: `whitelist.ts`
 * inserted `commandKey` unsplit, so the two-word alias `whitelist all` became a
 * single token `"whitelist all"`, left no subcommand, and silently no-opped.
 * That regression was introduced *by* wiring up the resolved envelope, in the
 * very call sites meant to remove duplicated tokenization — so the construction
 * now lives here exactly once.
 *
 * The command key is split on spaces because the registry's greedy
 * longest-prefix match resolves multi-word commands and aliases (`bank deposit`,
 * `whitelist all`) into a single canonical key.
 *
 * `rawText` is used only when the handler did not supply an envelope, which
 * happens for direct invocations from tests and internal callers.
 */
export function commandTokens(resolved: ResolvedCommandArgs, rawText: string): string[] {
    if (!resolved.commandKey) return getCommandWords(rawText);
    return [...resolved.commandKey.split(' ').filter(Boolean), ...getCommandWords(resolved.args)];
}

/**
 * Returns only the words of the matched command name, excluding arguments.
 *
 * Some tools need to recognise which spelling was invoked (`.brat animasi`,
 * `.allmenu`, `.register id`) without the payload, so `commandTokens` would mix
 * argument words into the comparison. Like `commandTokens` this reads the
 * handler-resolved key first and only tokenizes raw text as a fallback.
 */
export function commandNameWords(resolved: ResolvedCommandArgs, rawText: string, activePrefix: string = '.'): string[] {
    if (!resolved.commandKey) return getCommandWords(rawText, activePrefix);
    return resolved.commandKey.split(' ').filter(Boolean);
}

/**
 * Produces the lookup key used for destructive control keywords such as
 * `cancel`, `batal`, and `abort`.
 *
 * Cancellation terminates live financial and interactive sessions, so it must be
 * the narrowest match in the handler rather than the loosest. `normalizeCommandKey`
 * is deliberately forgiving — it folds `[-_\s]+` into single spaces so
 * `.apply-license` and `.apply license` resolve alike — which would make
 * `-cancel`, `cancel-`, and `_cancel` all trigger a cancellation.
 *
 * This variant therefore keeps hyphens and underscores significant and only
 * tolerates leading dots and whitespace runs, mirroring
 * `normalizeLegacyLookupKey` in `commandFormat.ts`.
 *
 * Examples: `. cancel` -> `cancel`, `-cancel` -> `-cancel` (not a keyword),
 * `CANCEL` -> `cancel`.
 */
export function normalizeControlKeyword(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw
        .toLowerCase()
        .replace(/^[.\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}
