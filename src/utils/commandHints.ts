/**
 * Contextual inline hints (Progressive Disclosure, Issue #71 Step 4).
 *
 * After a command succeeds, suggest one related command the user has not used
 * yet, pulled from the same domain adjacency map below.
 *
 * ponytail: usage memory is a per-process in-RAM map, so hints may re-fire once
 * after a bot restart (harmless, self-corrects on next use). Upgrade path:
 * persist used command keys in a `User` JSON column or match `ActivityLog`
 * types once every core command writes logs.
 */

/** Domain adjacency: canonical command key → related commands to suggest. */
const DOMAIN_ADJACENCY: Readonly<Record<string, readonly string[]>> = {
    'daily claim': ['bank', 'my profile'],
    work: ['daily claim', 'my profile'],
    balance: ['daily claim', 'work'],
    bank: ['balance', 'my profile'],
    'my profile': ['daily claim', 'balance']
};

const usedCommands = new Map<string, Set<string>>();

/** Records that a user executed a command (canonical key). */
export function recordCommandUse(userId: string, commandKey: string): void {
    let set = usedCommands.get(userId);
    if (!set) {
        set = new Set();
        usedCommands.set(userId, set);
    }
    set.add(commandKey);
}

/**
 * Returns the first adjacent command the user has not used yet, or null when
 * the command has no adjacency entry or every candidate has been used.
 */
export function pickHintCommand(userId: string, commandKey: string): string | null {
    const candidates = DOMAIN_ADJACENCY[commandKey];
    if (!candidates) return null;
    const used = usedCommands.get(userId);
    for (const candidate of candidates) {
        if (!used?.has(candidate)) return candidate;
    }
    return null;
}
