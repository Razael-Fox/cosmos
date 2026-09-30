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
 */
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
    type VersionBumpKind
} from '../src/utils/versioning.js';

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

function main(): void {
    const [command = 'show'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    switch (command) {
        case 'show':
            show();
            break;
        case 'check':
            check();
            break;
        case 'bump':
            bump((process.argv[3] ?? '') as VersionBumpKind);
            break;
        default:
            throw new Error(
                `Unknown command '${command}'. Expected 'show', 'check', or 'bump <patch|feature|generation>'.`
            );
    }
}

try {
    main();
} catch (err) {
    console.error(`[Version] ${(err as Error).message}`);
    process.exit(1);
}
