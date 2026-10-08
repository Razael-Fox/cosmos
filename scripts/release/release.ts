/**
 * Cosmos release automation.
 *
 * Publishes releases using the canonical Cosmos version format
 * `G<generation>-F<feature>-P<patch>` (see `docs/VERSIONING.md`). The
 * machine-readable metadata in `version.json` is the source of truth; this
 * script reconciles `package.json`, `CHANGELOG.md`, the Git tag, and the
 * GitHub Release with it.
 *
 * Usage:
 *   pnpm run release:pre                          # publish current version.json as a pre-release
 *   pnpm run release:pre -- G2-F24-P8             # publish an explicit version
 *   pnpm run release:pre -- --bump patch          # bump version.json, then publish
 *   pnpm run release:pre -- --bump feature        # complete a feature milestone, then publish
 *   pnpm run release:pre -- --bump generation     # new architecture generation, then publish
 *   pnpm run release:pre -- --stable              # publish without the --prerelease flag
 *   pnpm run release:pre -- --dry-run            # validate everything, publish nothing
 *   pnpm run release:pre -- --no-push            # commit and tag locally, skip the remote push
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
    VERSION_FILE_PATH,
    bumpVersion,
    formatVersion,
    getVersionInfo,
    isValidVersion,
    parseVersion,
    serializeVersionFile,
    today,
    type VersionBumpKind,
    type VersionInfo
} from '../../src/lib/versioning.js';

const BUMP_KINDS: VersionBumpKind[] = ['patch', 'feature', 'generation'];

function run(cmd: string, echo = true): string {
    if (echo) console.log(`> ${cmd}`);
    return execSync(cmd, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function readFlag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

function syncPackageJson(version: string): void {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    if (pkg.version === version) return;
    console.log(`[Release] Updating package.json version to ${version}`);
    pkg.version = version;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`);
}

/** Writes the new version into `version.json` and reconciles `package.json` if persist is true. */
function applyBump(kind: VersionBumpKind, persist: boolean): VersionInfo {
    const current = getVersionInfo();
    const bumped = bumpVersion(current, kind);
    const next: VersionInfo = {
        version: formatVersion(bumped),
        generation: bumped.generation,
        featureMilestone: bumped.featureMilestone,
        patch: bumped.patch,
        releaseDate: readFlag('date') ?? today()
    };
    if (persist) {
        fs.writeFileSync(VERSION_FILE_PATH, serializeVersionFile(next));
        syncPackageJson(next.version);
    }
    console.log(
        `[Release] Bumped ${current.version} -> ${next.version} (${kind} bump, released ${next.releaseDate})${persist ? '' : ' [dry run]'}`
    );
    return next;
}

/** Resolves the version to publish, honouring `--bump` and an explicit argument. */
function resolveTargetVersion(dryRun: boolean): VersionInfo {
    const bumpKind = readFlag('bump') as VersionBumpKind | undefined;
    if (bumpKind) {
        if (!BUMP_KINDS.includes(bumpKind)) {
            throw new Error(`[Release] Unknown --bump value '${bumpKind}'. Expected one of: ${BUMP_KINDS.join(', ')}.`);
        }
        return applyBump(bumpKind, !dryRun);
    }

    const info = getVersionInfo();
    const args = process.argv.slice(2);
    const flagValIndices = new Set<number>();
    for (const flag of ['bump', 'date']) {
        const idx = args.indexOf(`--${flag}`);
        if (idx !== -1 && idx + 1 < args.length) {
            flagValIndices.add(idx + 1);
        }
    }
    const explicit = args.find(
        (arg, index) => !arg.startsWith('--') && arg !== 'release' && !flagValIndices.has(index)
    );
    if (explicit) {
        if (!isValidVersion(explicit)) {
            throw new Error(
                `[Release] Refusing to publish '${explicit}'. Cosmos versions must use the G<generation>-F<feature>-P<patch> format ` +
                    `(e.g. G2-F24-P7, optionally suffixed with '.<YYYY-MM-DD>' and/or '-<status>'). See docs/VERSIONING.md.`
            );
        }
        const parsed = parseVersion(explicit);
        if (
            parsed.generation !== info.generation ||
            parsed.featureMilestone !== info.featureMilestone ||
            parsed.patch !== info.patch
        ) {
            throw new Error(
                `[Release] Version '${explicit}' does not match version.json ('${info.version}'). ` +
                    `Update version.json first (or pass --bump) so the metadata stays consistent.`
            );
        }
    }

    if (!dryRun) {
        syncPackageJson(info.version);
    }
    return info;
}

async function main() {
    const rootDir = process.cwd();
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const dryRun = hasFlag('dry-run');
    const skipPush = hasFlag('no-push') || dryRun;
    const isStable = hasFlag('stable');
    const releaseLabel = isStable ? 'release' : 'pre-release';

    const target = resolveTargetVersion(dryRun);
    const version = target.version;
    const changelog = fs.readFileSync(changelogPath, 'utf-8');

    console.log(`[Release] Target Version: ${version}`);
    console.log(`[Release] Release Date: ${target.releaseDate}`);
    console.log(`[Release] Mode: ${releaseLabel}${dryRun ? ' (dry run)' : ''}`);

    // 2. Guard: the changelog must already document the version being published.
    const changelogHeader = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
    if (!changelogHeader.test(changelog)) {
        throw new Error(
            `[Release] CHANGELOG.md has no '## [${version}]' section. ` +
                `Add the release notes under that exact header before publishing.`
        );
    }

    // 3. Determine target branch (defaults to the currently active branch).
    const currentBranch = run('git rev-parse --abbrev-ref HEAD');
    const targetBranch = process.env.RELEASE_BRANCH || currentBranch;
    if (currentBranch !== targetBranch) {
        console.log(`[Release] Switching from branch '${currentBranch}' to '${targetBranch}'...`);
        run(`git checkout -B ${targetBranch}`);
    }

    if (dryRun) {
        console.log('[Release] Dry run: skipping commit, push, tag, and GitHub Release.');
        console.log(`[Release] Would publish ${version} (${releaseLabel}).`);
        return;
    }

    // 4. Commit pending changes (ISSUE.md / SUMMARY.md are gitignored by design).
    const status = run('git status --porcelain', false);
    if (status) {
        run('git add .');
        run(`git commit -m "chore(release): prepare ${releaseLabel} ${version}"`);
    }

    // 5. Push the branch so the tag and release resolve against the remote.
    if (!skipPush) {
        console.log(`[Release] Pushing branch '${targetBranch}' to origin...`);
        run(`git push -u origin ${targetBranch}`);
    }

    // 6. Extract the release notes for this version from CHANGELOG.md.
    const versionHeaderRegex = new RegExp(
        `## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n---\\s*\\n## \\[|$)`
    );
    const notesMatch = changelog.match(versionHeaderRegex);
    const releaseNotes = notesMatch ? notesMatch[1].trim() : `${isStable ? 'Release' : 'Pre-release'} ${version}`;

    const tempNotesPath = path.join(rootDir, '.release_notes.tmp');
    fs.writeFileSync(tempNotesPath, releaseNotes, 'utf-8');

    // 7. Create the Git tag and the GitHub Release.
    const prereleaseFlag = isStable ? '' : ' --prerelease';
    const title = isStable ? version : `${version} (Pre-release)`;
    console.log(`[Release] Creating ${releaseLabel} ${version} on GitHub...`);
    try {
        run(
            `gh release create "${version}" --target "${targetBranch}"${prereleaseFlag} --title "${title}" --notes-file "${tempNotesPath}"`
        );
        console.log(`[Release] Successfully created ${releaseLabel} ${version} on GitHub!`);
        run(`gh release upload "${version}" "${changelogPath}" --clobber`);
        console.log(`[Release] Successfully uploaded CHANGELOG.md to ${releaseLabel} ${version}!`);
    } catch (err) {
        console.error(`[Release] Error executing gh release create:`, (err as Error).message || err);
        throw err;
    } finally {
        if (fs.existsSync(tempNotesPath)) {
            fs.unlinkSync(tempNotesPath);
        }
    }
}

main().catch((err: Error) => {
    console.error('[Release] Process failed:', err.message || err);
    process.exit(1);
});
