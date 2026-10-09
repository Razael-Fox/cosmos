/**
 * Cosmos MCP Server — tooling isolation check (AGENTS.md Rule X).
 *
 * Git worktrees such as `.worktrees/api` and `.worktrees/website` must be
 * ignored explicitly by ESLint, Prettier, and Git at the repository root.
 * Otherwise a sibling branch's plugin graph (for example
 * `eslint-plugin-react` against an ESLint flat config) breaks the root lint.
 *
 * `cosmos_schema_check` reports this as a machine-checkable pass/fail row so an
 * agent never has to remember it.
 */
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '#lib/versioning.js';

export interface IsolationTarget {
    tool: 'eslint' | 'prettier' | 'git';
    file: string;
    relativePath: string;
    /** `true` when the file declares an ignore for `.worktrees`. */
    ignoresWorktrees: boolean;
    /** `true` when the file exists. */
    present: boolean;
}

const TARGETS: Array<{ tool: IsolationTarget['tool']; file: string; patterns: RegExp[] }> = [
    {
        tool: 'eslint',
        file: 'eslint.config.js',
        patterns: [/['"`]\.worktrees\/\*\*['"`]/, /ignores\s*:\s*\[[^\]]*\.worktrees/]
    },
    {
        tool: 'prettier',
        file: '.prettierignore',
        patterns: [/^\s*\.worktrees\/?\s*$/m, /^\s*\.worktrees\/\*\*\s*$/m]
    },
    {
        tool: 'git',
        file: '.gitignore',
        patterns: [/^\s*\.worktrees\/?\s*$/m, /^\s*\.worktrees\/\*\*\s*$/m]
    }
];

function resolveRootFile(relativePath: string): string {
    const candidates = [path.resolve(REPO_ROOT, relativePath), path.resolve(process.cwd(), relativePath)];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

/** Verifies that ESLint, Prettier, and Git all ignore `.worktrees/**`. */
export function runToolingIsolationCheck(): { targets: IsolationTarget[]; pass: boolean; findings: string[] } {
    const findings: string[] = [];
    const targets: IsolationTarget[] = [];

    for (const target of TARGETS) {
        const absolutePath = resolveRootFile(target.file);
        if (!fs.existsSync(absolutePath)) {
            targets.push({
                tool: target.tool,
                file: absolutePath,
                relativePath: target.file,
                ignoresWorktrees: false,
                present: false
            });
            findings.push(`${target.file} is missing, so worktree isolation cannot be verified for ${target.tool}.`);
            continue;
        }
        const source = fs.readFileSync(absolutePath, 'utf8');
        const ignoresWorktrees = target.patterns.some((pattern) => pattern.test(source));
        targets.push({
            tool: target.tool,
            file: absolutePath,
            relativePath: target.file,
            ignoresWorktrees,
            present: true
        });
        if (!ignoresWorktrees) {
            findings.push(
                `${target.file} does not ignore .worktrees. Rule X requires explicit worktree isolation for ${target.tool}.`
            );
        }
    }

    return { targets, pass: findings.length === 0, findings };
}
