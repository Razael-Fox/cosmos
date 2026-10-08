import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Cosmos Versioning Utilities.
 *
 * Implements the canonical Cosmos version format documented in
 * `docs/VERSIONING.md`:
 *
 *   G<generation>-F<featureMilestone>-P<patch>[.<YYYY-MM-DD>][-<status>]
 *
 * The machine-readable metadata lives in `version.json` at the repository root.
 * This module is the single source of truth for parsing, validating,
 * formatting, comparing, and incrementing Cosmos version strings so that the
 * release script, CI/CD pipelines, and runtime logging all agree.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Resolves the repository root from both `src/` (tsx) and `dist/` (compiled) layouts. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Absolute path of the machine-readable version metadata file. */
export const VERSION_FILE_PATH = path.join(REPO_ROOT, 'version.json');

/** Canonical version format, e.g. `G2-F24-P7` or `G1-F12-P2.2026-09-30-beta`. */
export const VERSION_PATTERN =
    /^G(?<generation>\d+)-F(?<featureMilestone>\d+)-P(?<patch>\d+)(?:\.(?<releaseDate>\d{4}-\d{2}-\d{2}))?(?:-(?<status>alpha|beta|rc\d*|stable))?$/;

/** Optional development stage appended after the version core. */
export type VersionStatus = 'alpha' | 'beta' | 'rc' | 'stable';

/** Increment type accepted by {@link bumpVersion}. */
export type VersionBumpKind = 'patch' | 'feature' | 'generation';

/** Structured representation of `version.json`. */
export interface VersionInfo {
    /** Canonical version string, e.g. `G2-F24-P7`. Never carries a status suffix. */
    version: string;
    generation: number;
    featureMilestone: number;
    patch: number;
    /** ISO 8601 release date (`YYYY-MM-DD`). */
    releaseDate: string;
}

/** A parsed version string, including optional date and status segments. */
export interface ParsedVersion {
    generation: number;
    featureMilestone: number;
    patch: number;
    releaseDate?: string;
    status?: string;
}

/** Canonical release metadata shape stored in `version.json`. */
export interface VersionFile {
    version: string;
    generation: number;
    featureMilestone: number;
    patch: number;
    releaseDate: string;
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`[Versioning] '${field}' must be a non-negative integer, received: ${String(value)}.`);
    }
}

/**
 * Builds the canonical version string from its numeric components.
 *
 * @example formatVersion({ generation: 2, featureMilestone: 24, patch: 7 })
 * // "G2-F24-P7"
 */
export function formatVersion(info: Pick<VersionInfo, 'generation' | 'featureMilestone' | 'patch'>): string {
    return `G${info.generation}-F${info.featureMilestone}-P${info.patch}`;
}

/**
 * Parses a Cosmos version string.
 *
 * @throws Error when the input does not match the canonical format.
 */
export function parseVersion(input: string): ParsedVersion {
    const match = VERSION_PATTERN.exec(input.trim());
    if (!match?.groups) {
        throw new Error(
            `[Versioning] Invalid version '${input}'. Expected G<generation>-F<feature>-P<patch>, ` +
                `optionally suffixed with '.<YYYY-MM-DD>' and/or '-<status>' (e.g. G2-F24-P7 or G2-F24-P7.2026-09-30-beta).`
        );
    }
    const { generation, featureMilestone, patch, releaseDate, status } = match.groups;
    return {
        generation: Number(generation),
        featureMilestone: Number(featureMilestone),
        patch: Number(patch),
        ...(releaseDate ? { releaseDate } : {}),
        ...(status ? { status } : {})
    };
}

/** Non-throwing variant of {@link parseVersion}. */
export function isValidVersion(input: string): boolean {
    return VERSION_PATTERN.test(input.trim());
}

/**
 * Validates the metadata object persisted to `version.json`.
 *
 * Enforces the documented invariants: `version` mirrors the numeric
 * components, and `releaseDate` is a well-formed ISO 8601 calendar date.
 */
export function validateVersionFile(data: unknown): VersionFile {
    if (typeof data !== 'object' || data === null) {
        throw new Error('[Versioning] version.json must contain a JSON object.');
    }
    const record = data as Record<string, unknown>;

    assertNonNegativeInteger(record.generation, 'generation');
    assertNonNegativeInteger(record.featureMilestone, 'featureMilestone');
    assertNonNegativeInteger(record.patch, 'patch');

    const expected = formatVersion({
        generation: record.generation,
        featureMilestone: record.featureMilestone,
        patch: record.patch
    });
    if (record.version !== expected) {
        throw new Error(
            `[Versioning] version.json 'version' must be '${expected}', received: '${String(record.version)}'.`
        );
    }

    if (typeof record.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.releaseDate)) {
        throw new Error(
            `[Versioning] version.json 'releaseDate' must be an ISO 8601 date (YYYY-MM-DD), received: ${String(record.releaseDate)}.`
        );
    }
    const parsedDate = new Date(`${record.releaseDate}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== record.releaseDate) {
        throw new Error(
            `[Versioning] version.json 'releaseDate' is not a real calendar date: '${record.releaseDate}'.`
        );
    }

    return {
        version: record.version,
        generation: record.generation,
        featureMilestone: record.featureMilestone,
        patch: record.patch,
        releaseDate: record.releaseDate
    };
}

/**
 * Reads and validates `version.json`.
 *
 * This is the canonical accessor for the current Cosmos version. Callers that
 * only need to log or display a version should prefer this over importing
 * `package.json`, because the version string is not SemVer.
 */
export function getVersionInfo(filePath: string = VERSION_FILE_PATH): VersionInfo {
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
        throw new Error(`[Versioning] Unable to read version metadata at '${filePath}': ${(err as Error).message}`, {
            cause: err
        });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`[Versioning] version.json at '${filePath}' is not valid JSON: ${(err as Error).message}`, {
            cause: err
        });
    }
    return validateVersionFile(parsed);
}

/**
 * Serialises version metadata to the exact on-disk layout of `version.json`.
 *
 * Always call this instead of hand-editing the file so the derived `version`
 * string and the numeric components can never drift apart. The indentation
 * matches `.prettierrc` (`tabWidth: 4`) so `pnpm format` is a no-op on the
 * generated file.
 */
export function serializeVersionFile(info: VersionInfo): string {
    const normalized: VersionInfo = {
        version: formatVersion(info),
        generation: info.generation,
        featureMilestone: info.featureMilestone,
        patch: info.patch,
        releaseDate: info.releaseDate
    };
    validateVersionFile(normalized);
    return `${JSON.stringify(normalized, null, 4)}\n`;
}

/** Formats a version string with the optional ISO date segment appended. */
export function formatDatedVersion(version: string, releaseDate: string): string {
    const parsed = parseVersion(version);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
        throw new Error(`[Versioning] Invalid release date '${releaseDate}'. Expected ISO 8601 (YYYY-MM-DD).`);
    }
    return `${formatVersion(parsed)}.${releaseDate}`;
}

/** Today in ISO 8601 calendar-date form, used when stamping a release. */
export function today(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/**
 * Computes the next version for a given increment.
 *
 * - `patch`     -> `G2-F24-P7`  becomes `G2-F24-P8`
 * - `feature`   -> `G2-F24-P7`  becomes `G2-F25-P0` (patch resets)
 * - `generation`-> `G2-F24-P7`  becomes `G3-F1-P0`  (feature and patch reset)
 */
export function bumpVersion(
    info: Pick<VersionInfo, 'generation' | 'featureMilestone' | 'patch'>,
    kind: VersionBumpKind
): Pick<VersionInfo, 'generation' | 'featureMilestone' | 'patch'> {
    switch (kind) {
        case 'patch':
            return { ...info, patch: info.patch + 1 };
        case 'feature':
            return { ...info, featureMilestone: info.featureMilestone + 1, patch: 0 };
        case 'generation':
            return { generation: info.generation + 1, featureMilestone: 1, patch: 0 };
    }
}

/**
 * Compares two version strings by semantic significance.
 *
 * The date segment is metadata only and is deliberately ignored so that a
 * dated release compares equal to its undated counterpart.
 */
export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a);
    const right = parseVersion(b);
    const keys: Array<keyof ParsedVersion> = ['generation', 'featureMilestone', 'patch'];
    for (const key of keys) {
        const diff = (left[key] as number) - (right[key] as number);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/** Human-readable release description, e.g. `Generation 2 / Feature 24 / Patch 7`. */
export function describeVersion(version: string): string {
    const parsed = parseVersion(version);
    const parts = [`Generation ${parsed.generation}`, `Feature ${parsed.featureMilestone}`, `Patch ${parsed.patch}`];
    if (parsed.releaseDate) parts.push(`released ${parsed.releaseDate}`);
    if (parsed.status) parts.push(`status ${parsed.status}`);
    return parts.join(' / ');
}
// p
