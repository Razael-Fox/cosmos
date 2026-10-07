import assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Verifies that `pnpm run version:verify` detects a parallel-branch version
 * collision, which is the failure mode described in
 * docs/VERSIONING.md ("Parallel Branches & Version Collisions").
 *
 * Two PRs branched from the same commit both run `version:bump` against the same
 * local version.json and independently compute the same next version. Without the
 * `--against` check, the second PR to merge silently duplicates a version that is
 * already live on the base branch.
 */

const REPO_ROOT = path.resolve(process.cwd());
// `version.ts` resolves VERSION_FILE_PATH relative to its own module location, so the
// scratch clone MUST run its own copy of the script. Pointing at the original repo's
// file would read the original repo's version.json instead of the clone's.
const SOURCE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'release', 'version.ts');

interface RunResult {
    status: number;
    /** Combined stdout + stderr: the CLI reports failures via console.error. */
    output: string;
}

function runIn(cwd: string, args: string[]): RunResult {
    const script = path.join(cwd, 'scripts', 'release', 'version.ts');
    // `git checkout -B <branch>` restores tracked files, which would silently revert
    // this script back to the committed copy. Re-sync it before every invocation so
    // the test always exercises the working-tree version of the CLI.
    fs.mkdirSync(path.join(clonePath, 'scripts', 'release'), { recursive: true });
    fs.copyFileSync(SOURCE_SCRIPT, script);
    const result = spawnSync('pnpm', ['exec', 'tsx', script, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return {
        status: result.status ?? 1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`
    };
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

console.log('--- STARTING VERSION COLLISION TESTS ---');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-version-collide-'));
const clonePath = path.join(workspace, 'repo');
const realVersionFile = path.join(REPO_ROOT, 'version.json');
const realVersionBefore = fs.readFileSync(realVersionFile, 'utf-8');

try {
    console.log('[Test 1] Cloning the repository into a scratch workspace...');
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, clonePath], { encoding: 'utf-8' });
    fs.mkdirSync(path.join(clonePath, 'scripts', 'release'), { recursive: true });
    fs.copyFileSync(SOURCE_SCRIPT, path.join(clonePath, 'scripts', 'release', 'version.ts'));
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(clonePath, 'node_modules'));

    // Build a minimal history: a base commit carrying an older version.json, then
    // two branches that each bump it by exactly one patch.
    console.log('[Test 2] Building two branches that bump the same base version...');
    git(clonePath, ['checkout', '--quiet', '-B', 'sim-main', 'HEAD~1']);
    const baseVersion = JSON.parse(fs.readFileSync(path.join(clonePath, 'version.json'), 'utf-8')) as {
        version: string;
    };
    console.log(`  Base version: ${baseVersion.version}`);

    git(clonePath, ['checkout', '--quiet', '-B', 'pr-a', 'sim-main']);
    const bumpA = runIn(clonePath, ['bump', 'patch']);
    assert.strictEqual(bumpA.status, 0, `PR-A bump must succeed:\n${bumpA.output}`);
    const versionA = (JSON.parse(fs.readFileSync(path.join(clonePath, 'version.json'), 'utf-8')) as { version: string })
        .version;
    git(clonePath, ['commit', '--quiet', '-am', 'chore: pr-a version bump']);
    console.log(`  PR-A version: ${versionA}`);

    git(clonePath, ['checkout', '--quiet', 'sim-main']);
    git(clonePath, ['merge', '--quiet', '--no-ff', 'pr-a', '-m', 'merge pr-a']);
    const mergedVersion = (
        JSON.parse(fs.readFileSync(path.join(clonePath, 'version.json'), 'utf-8')) as { version: string }
    ).version;
    assert.strictEqual(mergedVersion, versionA, 'sim-main must now carry the PR-A version');
    console.log(`  main after merge: ${mergedVersion}`);

    git(clonePath, ['checkout', '--quiet', '-B', 'pr-b', 'sim-main~1']);
    const bumpB = runIn(clonePath, ['bump', 'patch']);
    assert.strictEqual(bumpB.status, 0, `PR-B bump must succeed:\n${bumpB.output}`);
    const versionB = (JSON.parse(fs.readFileSync(path.join(clonePath, 'version.json'), 'utf-8')) as { version: string })
        .version;
    git(clonePath, ['commit', '--quiet', '-am', 'chore: pr-b version bump']);
    assert.strictEqual(versionB, versionA, 'Both branches must independently compute the SAME version');
    console.log(`  PR-B version: ${versionB} (collides with main)`);

    const baseSha = git(clonePath, ['rev-parse', 'sim-main~1']);

    console.log('[Test 3] A base-only check passes (this is why it is not enough)...');
    const baseOnly = runIn(clonePath, ['verify', '--base', baseSha]);
    assert.strictEqual(baseOnly.status, 0, 'Checking against the merge base alone cannot see the collision');
    console.log('✓ Base-only check passes as expected.');

    console.log('[Test 4] The --against check detects the collision...');
    const withAgainst = runIn(clonePath, ['verify', '--base', baseSha, '--against', 'sim-main']);
    assert.strictEqual(withAgainst.status, 1, 'Collision check must fail the build');
    assert.ok(
        withAgainst.output.includes('Version collision'),
        `Expected a collision diagnostic, got:\n${withAgainst.output}`
    );
    assert.ok(withAgainst.output.includes('git rebase'), 'The diagnostic must tell the contributor how to resolve it');
    console.log('✓ Collision detected with actionable remediation.');

    console.log('[Test 5] Rebase + rebump resolves the collision...');
    git(clonePath, ['rebase', 'sim-main']);
    const rebump = runIn(clonePath, ['bump', 'patch']);
    assert.strictEqual(rebump.status, 0, `Rebump must succeed:\n${rebump.output}`);
    git(clonePath, ['commit', '--quiet', '-am', 'chore: rebump after rebase']);
    const versionC = (JSON.parse(fs.readFileSync(path.join(clonePath, 'version.json'), 'utf-8')) as { version: string })
        .version;
    assert.notStrictEqual(versionC, versionA, 'Rebumped version must differ from the taken version');
    const resolved = runIn(clonePath, ['verify', '--base', baseSha, '--against', 'sim-main']);
    assert.strictEqual(resolved.status, 0, `Rebased+rebumped branch must verify:\n${resolved.output}`);
    console.log(`✓ Rebase + rebump yields a unique version (${versionC}).`);

    console.log('--- ALL VERSION COLLISION TESTS PASSED ---');
} finally {
    fs.rmSync(workspace, { recursive: true, force: true });

    // `version.ts` resolves VERSION_FILE_PATH from its own module location, so a
    // mis-wired invocation would silently bump the REAL repository's version.json
    // instead of the scratch clone. Assert the working tree was left untouched.
    const realVersionAfter = fs.readFileSync(realVersionFile, 'utf-8');
    assert.strictEqual(
        realVersionAfter,
        realVersionBefore,
        'This test must never mutate the real repository version.json'
    );
    console.log('✓ Real repository version.json left untouched.');
}
