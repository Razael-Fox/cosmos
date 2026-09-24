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
