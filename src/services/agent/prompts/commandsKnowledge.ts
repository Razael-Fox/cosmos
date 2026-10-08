import fs from 'fs';
import path from 'path';

let cachedKnowledgeBase: string | null = null;

/**
 * Loads the full Cosmos command context knowledge base from docs/COMMANDS_CONTEXT.md.
 * Cached in memory after the first read.
 */
export function getCommandsKnowledgeBase(): string {
    if (cachedKnowledgeBase !== null) {
        return cachedKnowledgeBase;
    }

    const candidatePaths = [
        path.resolve(process.cwd(), 'docs', 'COMMANDS_CONTEXT.md'),
        path.resolve(process.cwd(), '..', 'docs', 'COMMANDS_CONTEXT.md'),
        '/app/docs/COMMANDS_CONTEXT.md'
    ];

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            try {
                cachedKnowledgeBase = fs.readFileSync(p, 'utf-8');
                return cachedKnowledgeBase;
            } catch (err) {
                console.warn('[CommandsKnowledgeBase] Failed to read from', p, err);
            }
        }
    }

    return '';
}

/**
 * Maximum characters of the knowledge base attached to a single prompt.
 *
 * The full document is roughly 22.5 KB (~6,100 tokens). Combined with the Sara
 * persona that alone exceeds the provider's per-minute token ceiling, so
 * commands-help requests were rejected with HTTP 413 even when the command
 * reference was the only subject.
 *
 * `getCommandsKnowledgeBase()` remains available for callers that genuinely need
 * the whole document; this bounded variant is what the persona prompt uses.
 */
export const COMMANDS_KNOWLEDGE_MAX_CHARS = 6000;

/**
 * Returns the knowledge base truncated to `COMMANDS_KNOWLEDGE_MAX_CHARS`, cut at a
 * heading boundary so no entry is left half-written.
 */
export function getCommandsKnowledgeExcerpt(limit: number = COMMANDS_KNOWLEDGE_MAX_CHARS): string {
    const kb = getCommandsKnowledgeBase();
    if (kb.length <= limit) return kb;

    const window = kb.slice(0, limit);
    const boundary = window.lastIndexOf('\n##');
    return boundary > limit * 0.5 ? window.slice(0, boundary) : window;
}
