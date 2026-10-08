/**
 * Cosmos version metadata CLI.
 *
 * Reads, validates, and increments `version.json` (the canonical source of
 * truth for the `G<generation>-F<feature>-P<patch>` format documented in
 * `docs/VERSIONING.md`).
 *
 * Usage:
 *   pnpm run version:show                 # print the current version metadata
 *   pnpm run version:show -- --json       # print raw version.json contents
 *   pnpm run version:bump patch           # G2-F24-P7  -> G2-F24-P8
 *   pnpm run version:bump feature         # G2-F24-P7  -> G2-F25-P0
 *   pnpm run version:bump generation      # G2-F24-P7  -> G3-F1-P0
 *   pnpm run version:bump patch -- --date 2026-10-01
 *   pnpm run version:check                # validate version.json invariants
 *   pnpm run version:verify -- --base <sha>  # enforce the Rule S.1 update policy
 *   pnpm run version:verify -- --base <sha> --against origin/main
 *                                           # additionally detect a patch-number
 *                                           # collision with the current base-branch tip
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import {
    VERSION_FILE_PATH,
    bumpVersion,
    compareVersions,
    describeVersion,
    formatVersion,
    getVersionInfo,
    isValidVersion,
    parseVersion,
    serializeVersionFile,
    today,
    validateVersionFile,
    type VersionBumpKind,
    type VersionInfo
} from '../../src/lib/versioning.js';

const BUMP_KINDS: VersionBumpKind[] = ['patch', 'feature', 'generation'];

function readFlag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

function readPackageJsonVersion(): string | undefined {
    try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as { version?: string };
        return pkg.version;
    } catch {
        return undefined;
    }
}

function syncPackageJsonVersion(version: string): void {
    const current = readPackageJsonVersion();
    if (current === version) return;
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as Record<string, unknown>;
    pkg.version = version;
    fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 4)}\n`);
    console.log(`[Version] Updated package.json version: ${current} -> ${version}`);
}

function show(): void {
    if (process.argv.includes('--json')) {
        console.log(fs.readFileSync(VERSION_FILE_PATH, 'utf-8').trim());
        return;
    }
    const info = getVersionInfo();
    console.log(`[Version] ${info.version}`);
    console.log(`[Version] Generation: ${info.generation}`);
    console.log(`[Version] Feature Milestone: ${info.featureMilestone}`);
    console.log(`[Version] Patch: ${info.patch}`);
    console.log(`[Version] Release Date: ${info.releaseDate}`);
    console.log(`[Version] Summary: ${describeVersion(info.version)}`);
}

function check(): void {
    const info = getVersionInfo();
    validateVersionFile(info);
    const pkgVersion = readPackageJsonVersion();
    if (pkgVersion !== info.version) {
        throw new Error(
            `[Version] package.json version ('${pkgVersion}') is out of sync with version.json ('${info.version}'). ` +
                `Run 'pnpm run version:bump' or 'pnpm run release:pre' to reconcile.`
        );
    }
    console.log(`[Version] OK - ${info.version} (${describeVersion(info.version)})`);
}

function bump(kind: VersionBumpKind): void {
    if (!BUMP_KINDS.includes(kind)) {
        throw new Error(`Unknown bump kind '${kind}'. Expected one of: ${BUMP_KINDS.join(', ')}.`);
    }
    const current = getVersionInfo();
    const next = bumpVersion(current, kind);
    const releaseDate = readFlag('date') ?? today();
    const updated = { ...next, version: formatVersion(next), releaseDate };

    fs.writeFileSync(VERSION_FILE_PATH, serializeVersionFile(updated));
    console.log(`[Version] ${current.version} -> ${updated.version} (${kind} bump)`);
    console.log(`[Version] Release date: ${updated.releaseDate}`);
    syncPackageJsonVersion(updated.version);

    const pkgs = readPackageJsonVersion();
    if (pkgs) {
        console.log(`[Version] package.json is in sync at ${pkgs}`);
    }
    if (compareVersions(current.version, updated.version) >= 0) {
        throw new Error('Bump did not produce a strictly greater version.');
    }
    if (!isValidVersion(updated.version) || parseVersion(updated.version).patch < 0) {
        throw new Error(`Bump produced an invalid version: ${updated.version}`);
    }
}

/** Paths whose modification mandates a version.json update (AGENTS.md Rule S.1). */
const VERSION_TRIGGER_PATHS = ['src', 'prisma', 'scripts', 'docker', '.github/workflows'] as const;

/** Runs a git command with argument array, returning trimmed stdout, or `null` when the command fails. */
function git(args: string[]): string | null {
    try {
        return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

/** Reports whether a git command succeeded, regardless of its (possibly empty) output. */
function gitSucceeds(args: string[]): boolean {
    try {
        execFileSync('git', args, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads and validates the version.json recorded at a git ref.
 *
 * Returns `null` when the ref is unavailable or predates the version.json
 * migration, so callers can degrade to "no information" rather than failing.
 */
function readVersionAtRef(ref: string): VersionInfo | null {
    if (!gitSucceeds(['cat-file', '-e', `${ref}^{commit}`])) return null;
    const raw = git(['show', `${ref}:version.json`]);
    if (raw === null) return null;
    try {
        return validateVersionFile(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Enforces the mandatory version metadata update policy against a base commit.
 *
 * 1. Any change under a version-trigger path must be accompanied by a
 *    version.json change.
 * 2. When version.json did change, the new version must be strictly greater
 *    than the base version (no downgrades, no duplicate versions).
 * 3. When `--against` is supplied (typically the current base-branch tip such as
 *    `origin/main`), the new version must also be strictly greater than *that*
 *    version. This catches the parallel-branch collision where two PRs branched
 *    from the same commit both bump `G2-F24-P8` to `G2-F24-P9`: the second PR to
 *    merge would otherwise silently ship a version already taken on `main`.
 */
function verify(baseRef: string | undefined, againstRef?: string): void {
    check();

    if (!baseRef) {
        console.log('[Version] No base reference supplied; skipping the update-policy check.');
        return;
    }
    if (baseRef === '0000000000000000000000000000000000000000') {
        console.log('[Version] Initial push detected; skipping the update-policy check.');
        return;
    }
    if (!gitSucceeds(['cat-file', '-e', `${baseRef}^{commit}`])) {
        throw new Error(
            `[Version] Base commit '${baseRef}' is unavailable. Ensure the base commit is fetched or verify the base SHA.`
        );
    }

    const baseRaw = git(['show', `${baseRef}:version.json`]);
    if (baseRaw === null) {
        console.log('[Version] Base commit has no version.json (pre-migration); skipping the update-policy check.');
        return;
    }

    const base = validateVersionFile(JSON.parse(baseRaw));
    const head = getVersionInfo();
    console.log(`[Version] Base version: ${base.version}`);
    console.log(`[Version] Head version: ${head.version}`);

    const problems: string[] = [];
    const changedTriggers = git(['diff', '--name-only', baseRef, '--', ...VERSION_TRIGGER_PATHS]) ?? '';
    const versionFileChanged = (git(['diff', '--name-only', baseRef, '--', 'version.json']) ?? '') !== '';

    if (!versionFileChanged && changedTriggers) {
        problems.push(
            'Product code changed without a version.json update:\n' +
                changedTriggers
                    .split('\n')
                    .map((line) => `  - ${line}`)
                    .join('\n') +
                '\n\nPer AGENTS.md Rule S.1, run: pnpm run version:bump patch|feature|generation'
        );
    } else if (!versionFileChanged) {
        console.log('[Version] No product code changed; no version bump was required.');
        return;
    }

    if (compareVersions(base.version, head.version) >= 0) {
        problems.push(
            `The committed version must be strictly greater than the base version (${base.version}), ` +
                `but it is ${head.version}. Run: pnpm run version:bump patch|feature|generation`
        );
    }

    if (againstRef) {
        if (!gitSucceeds(['cat-file', '-e', `${againstRef}^{commit}`])) {
            problems.push(`Cannot resolve --against ref '${againstRef}'. Fetch the ref or fix the --against value.`);
        } else {
            const tip = readVersionAtRef(againstRef);
            if (!tip) {
                console.log(
                    `[Version] Base-branch tip '${againstRef}' has no readable version.json (pre-migration); skipping collision check.`
                );
            } else {
                console.log(`[Version] Base-branch tip version (${againstRef}): ${tip.version}`);
                if (compareVersions(tip.version, head.version) >= 0) {
                    problems.push(
                        `Version collision with the base-branch tip (${againstRef} is at ${tip.version}, ` +
                            `this branch is at ${head.version}).\n\n` +
                            'Another branch has already claimed that version number. Rebase onto the latest ' +
                            'base branch and bump again so this branch lands on a unique version:\n' +
                            '  git fetch origin\n' +
                            '  git rebase origin/main\n' +
                            '  pnpm run version:bump patch|feature|generation\n' +
                            '  pnpm run version:check\n' +
                            '  git commit -am "chore(versioning): rebump to <new version>" && git push --force-with-lease'
                    );
                }
            }
        }
    }
    if (problems.length > 0) {
        throw new Error(problems.join('\n\n'));
    }

    console.log('[Version] version.json was updated and the version increase is monotonic.');
}

function main(): void {
    const [command = 'show'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    switch (command) {
        case 'show':
            show();
            break;
        case 'check':
            check();
            break;
        case 'verify':
            verify(readFlag('base'), readFlag('against'));
            break;
        case 'bump':
            bump((process.argv[3] ?? '') as VersionBumpKind);
            break;
        default:
            throw new Error(
                `Unknown command '${command}'. Expected 'show', 'check', 'verify', or 'bump <patch|feature|generation>'.`
            );
    }
}

try {
    main();
} catch (err) {
    console.error(`[Version] ${(err as Error).message}`);
    process.exit(1);
}
