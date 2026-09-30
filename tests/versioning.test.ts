import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    bumpVersion,
    compareVersions,
    describeVersion,
    formatDatedVersion,
    formatVersion,
    getVersionInfo,
    isValidVersion,
    parseVersion,
    serializeVersionFile,
    validateVersionFile
} from '../src/utils/versioning.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Cosmos versioning utilities', () => {
    describe('formatVersion', () => {
        it('assembles the canonical G-F-P string', () => {
            assert.strictEqual(formatVersion({ generation: 2, featureMilestone: 24, patch: 7 }), 'G2-F24-P7');
            assert.strictEqual(formatVersion({ generation: 1, featureMilestone: 1, patch: 0 }), 'G1-F1-P0');
        });
    });

    describe('parseVersion', () => {
        it('parses the core format', () => {
            assert.deepStrictEqual(parseVersion('G2-F24-P7'), {
                generation: 2,
                featureMilestone: 24,
                patch: 7
            });
        });

        it('parses the optional date segment', () => {
            assert.deepStrictEqual(parseVersion('G1-F12-P2.2026-09-30'), {
                generation: 1,
                featureMilestone: 12,
                patch: 2,
                releaseDate: '2026-09-30'
            });
        });

        it('parses the optional status segment after the date', () => {
            assert.deepStrictEqual(parseVersion('G2-F24-P7.2026-09-30-beta'), {
                generation: 2,
                featureMilestone: 24,
                patch: 7,
                releaseDate: '2026-09-30',
                status: 'beta'
            });
        });

        it('parses every documented status', () => {
            for (const status of ['alpha', 'beta', 'rc1', 'stable']) {
                assert.strictEqual(parseVersion(`G2-F24-P7-${status}`).status, status);
            }
        });

        it('rejects legacy and malformed formats', () => {
            for (const invalid of ['RF-2609-21', '1.0.0', 'v1.0.0', 'G2-F24', 'G2-F24-P', 'GX-F1-P0', 'G2-F24-P7-']) {
                assert.throws(() => parseVersion(invalid), /Invalid version/, `expected '${invalid}' to be rejected`);
                assert.strictEqual(isValidVersion(invalid), false);
            }
        });
    });

    describe('bumpVersion', () => {
        const base = { generation: 2, featureMilestone: 24, patch: 7 };

        it('increments the patch counter', () => {
            assert.deepStrictEqual(bumpVersion(base, 'patch'), { generation: 2, featureMilestone: 24, patch: 8 });
        });

        it('increments the feature milestone and resets the patch counter', () => {
            assert.deepStrictEqual(bumpVersion(base, 'feature'), { generation: 2, featureMilestone: 25, patch: 0 });
        });

        it('increments the generation and resets both the feature milestone and the patch counter', () => {
            assert.deepStrictEqual(bumpVersion({ generation: 2, featureMilestone: 40, patch: 12 }, 'generation'), {
                generation: 3,
                featureMilestone: 1,
                patch: 0
            });
        });

        it('never mutates the input', () => {
            bumpVersion(base, 'patch');
            assert.deepStrictEqual(base, { generation: 2, featureMilestone: 24, patch: 7 });
        });
    });

    describe('compareVersions', () => {
        it('orders by generation, then feature milestone, then patch', () => {
            assert.strictEqual(compareVersions('G1-F99-P99', 'G2-F1-P0'), -1);
            assert.strictEqual(compareVersions('G2-F24-P8', 'G2-F24-P7'), 1);
            assert.strictEqual(compareVersions('G2-F25-P0', 'G2-F24-P7'), 1);
        });

        it('treats a dated version as equal to its undated counterpart', () => {
            assert.strictEqual(compareVersions('G2-F24-P7.2026-09-30', 'G2-F24-P7'), 0);
        });
    });

    describe('formatDatedVersion', () => {
        it('appends the ISO date segment', () => {
            assert.strictEqual(formatDatedVersion('G1-F12-P2', '2026-09-30'), 'G1-F12-P2.2026-09-30');
        });

        it('rejects a non ISO date', () => {
            assert.throws(() => formatDatedVersion('G1-F12-P2', '30-09-2026'), /Invalid release date/);
        });
    });

    describe('describeVersion', () => {
        it('summarises every component', () => {
            assert.strictEqual(describeVersion('G2-F24-P7'), 'Generation 2 / Feature 24 / Patch 7');
            assert.strictEqual(
                describeVersion('G2-F24-P7.2026-09-30-beta'),
                'Generation 2 / Feature 24 / Patch 7 / released 2026-09-30 / status beta'
            );
        });
    });

    describe('validateVersionFile', () => {
        const valid = {
            version: 'G2-F24-P7',
            generation: 2,
            featureMilestone: 24,
            patch: 7,
            releaseDate: '2026-09-30'
        };

        it('accepts consistent metadata', () => {
            assert.deepStrictEqual(validateVersionFile(valid), valid);
        });

        it('rejects a version string that drifts from the numeric components', () => {
            assert.throws(() => validateVersionFile({ ...valid, version: 'G2-F24-P8' }), /must be 'G2-F24-P7'/);
        });

        it('rejects negative or non-integer components', () => {
            assert.throws(
                () => validateVersionFile({ ...valid, generation: -1, version: 'G-1-F24-P7' }),
                /non-negative integer/
            );
            assert.throws(() => validateVersionFile({ ...valid, patch: 1.5 }), /non-negative integer/);
        });

        it('rejects a malformed or impossible release date', () => {
            assert.throws(() => validateVersionFile({ ...valid, releaseDate: '2026/09/30' }), /ISO 8601/);
            assert.throws(() => validateVersionFile({ ...valid, releaseDate: '2026-02-30' }), /real calendar date/);
        });

        it('rejects a non-object payload', () => {
            assert.throws(() => validateVersionFile(null), /must contain a JSON object/);
        });
    });

    describe('serializeVersionFile', () => {
        it('derives the version string and normalises the output layout', () => {
            const raw = serializeVersionFile({
                version: 'stale',
                generation: 3,
                featureMilestone: 1,
                patch: 0,
                releaseDate: '2026-09-30'
            });
            assert.deepStrictEqual(JSON.parse(raw), {
                version: 'G3-F1-P0',
                generation: 3,
                featureMilestone: 1,
                patch: 0,
                releaseDate: '2026-09-30'
            });
            assert.ok(raw.endsWith('\n'));
            // Matches .prettierrc (tabWidth: 4) so `pnpm format` is a no-op.
            assert.ok(raw.includes('\n    "version": "G3-F1-P0",'));
        });

        it('always rewrites a stale version string from the numeric components', () => {
            const raw = serializeVersionFile({
                version: 'G1-F1-P0',
                generation: 2,
                featureMilestone: 24,
                patch: 7,
                releaseDate: '2026-09-30'
            });
            assert.strictEqual(JSON.parse(raw).version, 'G2-F24-P7');
        });

        it('refuses to serialise invalid metadata', () => {
            assert.throws(
                () =>
                    serializeVersionFile({
                        version: 'G2-F24-P7',
                        generation: 2,
                        featureMilestone: 24,
                        patch: 7,
                        releaseDate: '2026-13-01'
                    }),
                /real calendar date/
            );
            assert.throws(
                () =>
                    serializeVersionFile({
                        version: 'G2-F24-P7',
                        generation: 2,
                        featureMilestone: 24,
                        patch: -1,
                        releaseDate: '2026-09-30'
                    }),
                /non-negative integer/
            );
        });
    });

    describe('version.json repository metadata', () => {
        it('exposes valid, in-sync metadata', () => {
            const info = getVersionInfo();
            assert.strictEqual(info.version, formatVersion(info));
            assert.ok(isValidVersion(info.version));
            assert.match(info.releaseDate, /^\d{4}-\d{2}-\d{2}$/);
            assert.ok(Number.isInteger(info.generation) && info.generation >= 0);
            assert.ok(Number.isInteger(info.featureMilestone) && info.featureMilestone >= 0);
            assert.ok(Number.isInteger(info.patch) && info.patch >= 0);
        });

        it('matches the version declared in package.json', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
                version: string;
            };
            assert.strictEqual(pkg.version, getVersionInfo().version);
        });

        it('is stored at the repository root', () => {
            assert.ok(fs.existsSync(path.join(REPO_ROOT, 'version.json')));
        });
    });

    describe('mandatory update policy (AGENTS.md Rule S.1)', () => {
        const info = getVersionInfo();

        it('produces a strictly greater version for every increment kind', () => {
            for (const kind of ['patch', 'feature', 'generation'] as const) {
                const asString = formatVersion(bumpVersion(info, kind));
                assert.ok(isValidVersion(asString), `${asString} must be a valid version`);
                assert.ok(compareVersions(asString, info.version) > 0, `${asString} must exceed ${info.version}`);
            }
        });

        it('covers every documented trigger path', () => {
            // Mirrors VERSION_TRIGGER_PATHS in scripts/version.ts.
            for (const p of ['src', 'prisma', 'scripts', 'docker', '.github/workflows']) {
                assert.ok(fs.existsSync(path.join(REPO_ROOT, p)), `trigger path '${p}' must exist`);
            }
        });

        it('ships the CI enforcement workflow', () => {
            const workflow = path.join(REPO_ROOT, '.github', 'workflows', 'version-policy.yml');
            assert.ok(fs.existsSync(workflow), 'version-policy.yml must exist');
            const raw = fs.readFileSync(workflow, 'utf-8');
            assert.ok(raw.includes('version:verify'), 'workflow must invoke version:verify');
            assert.ok(raw.includes('pull_request'), 'workflow must run on pull requests');
        });

        it('exposes the version:verify script in package.json', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
                scripts: Record<string, string>;
            };
            assert.ok(pkg.scripts['version:verify'], 'package.json must define version:verify');
        });
    });
});
