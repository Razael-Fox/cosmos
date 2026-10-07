# Cosmos Versioning Specification

> Canonical specification for the Cosmos versioning format. `version.json` at the
> repository root is the machine-readable source of truth consumed by CI/CD and
> `src/utils/versioning.ts`. Human-readable guidance for AI Agents lives in
> `AGENTS.md` (Rule S) and `.agents/skills/cosmos-versioning/SKILL.md`.

## Overview

Cosmos uses a custom versioning format that focuses on product development and feature milestones.

**Format**

```text
G<generation>-F<feature>-P<patch>[.<YYYY-MM-DD>]
```

The date segment is optional. If present, it is the release date (ISO 8601).

**Example**

```text
G2-F24-P7
G1-F12-P2.2026-09-30
```

**Meaning**

| Component               | Value      |
| ----------------------- | ---------- |
| Generation              | 2          |
| Feature Milestone       | 24         |
| Patch                   | 7          |
| Release Date (optional) | 2026-09-30 |

---

## Machine-Readable Metadata

All version metadata is stored in `version.json` at the repository root so that
CI/CD pipelines, release scripts, and AI Agents can read it without parsing
Markdown or Git tags.

```json
{
    "version": "G2-F24-P7",
    "generation": 2,
    "featureMilestone": 24,
    "patch": 7,
    "releaseDate": "2026-09-30"
}
```

| Field              | Type    | Description                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------ |
| `version`          | string  | Canonical version string in `G<generation>-F<feature>-P<patch>` form.                |
| `generation`       | integer | Numeric generation, mirrors the `G` component.                                       |
| `featureMilestone` | integer | Numeric feature milestone, mirrors the `F` component.                                |
| `patch`            | integer | Numeric patch counter, mirrors the `P` component.                                    |
| `releaseDate`      | string  | ISO 8601 release date (`YYYY-MM-DD`). Must match the date the version was published. |

**Invariants enforced by tooling**

- `version` MUST equal `G${generation}-F${featureMilestone}-P${patch}`.
- All numeric components MUST be non-negative integers.
- `releaseDate` MUST match `/^\d{4}-\d{2}-\d{2}$/`.
- The optional date suffix and the optional status suffix are **not** stored in
  `version.json`; they are derived at release time (tag / GitHub Release name).

Read it programmatically with the shared utility:

```typescript
import { getVersionInfo, formatVersion } from './utils/versioning.js';

const info = getVersionInfo(); // { version, generation, featureMilestone, patch, releaseDate }
console.log(formatVersion(info)); // "G2-F24-P7"
```

- The `version` field in `package.json` MUST always equal `version.json`.

---

## Mandatory Update Policy

`version.json` is a version commitment recorded in Git history. Every change that
alters product behaviour **must** leave a trace in `version.json` **within the
same commit**. Deferring the increment to a later commit, or shipping a product
change without any increment, is prohibited.

### Trigger table

| Changed path                                                             | Increment    | Required |
| :----------------------------------------------------------------------- | :----------- | :------- |
| `src/**`, `prisma/**`, `scripts/**`, `docker/**`, `.github/workflows/**` | `patch`      | Yes (CI) |
| A new feature, command, or subsystem completed and ready for use         | `feature`    | Yes      |
| Major refactor, major database migration, framework replacement          | `generation` | Yes      |
| Bug fix, new validation, optimization, UI/UX improvement                 | `patch`      | Yes      |
| `README.md`, `docs/**`, `AGENTS.md`, `.agents/**`                        | `patch`      | Yes      |
| Other `*.md`, `ISSUE.md`, `SUMMARY.md`, formatting, typos, whitespace    | —            | No       |

Rows marked **(CI)** are enforced automatically by
`.github/workflows/version-policy.yml`. The remaining rows are the contributor's
obligation and are not machine-detected.

### Required procedure

1. Determine the increment kind from the trigger table.
2. Run `pnpm run version:bump patch|feature|generation`.
3. Run `pnpm run version:check` to validate invariants and `package.json` sync.
4. Run `pnpm run version:verify -- --base HEAD` to mirror CI locally.
5. Stage `version.json`, `package.json`, and `CHANGELOG.md` in the same commit as
   the code change.

### Automated guard

The `version-policy` job runs on every push to `main` and every pull request. It
invokes `pnpm run version:verify -- --base <base-sha>`, which verifies that:

1. `version.json` changed whenever a trigger path changed.
2. The new version is strictly greater than the base version, preventing
   downgrades and duplicate versions.
3. The `version.json` invariants hold and stay in sync with `package.json`.

On pull requests a second step runs with `--against origin/<base-ref>`, which adds:

4. The new version is strictly greater than the **current tip of the base branch**,
   not merely the merge base. This is the parallel-branch collision check
   described in [Parallel Branches & Version Collisions](#parallel-branches--version-collisions).

---

## Parallel Branches & Version Collisions

`version:bump` reads the **local working copy** of `version.json`. It does not and
cannot know what other branches have already claimed, so two PRs branched from the
same commit independently compute the _same_ next version:

```text
main          G2-F24-P8
├─ PR-A       G2-F24-P8 → G2-F24-P9   (merged first)  → main is now G2-F24-P9
└─ PR-B       G2-F24-P8 → G2-F24-P9   (still open)    → COLLISION
```

Without intervention, merging PR-B either produces a `version.json` merge conflict
or — worse — silently lands `G2-F24-P9` a second time, so two different code
states claim the same version. `CHANGELOG.md` then has two sections for one version,
and the tag `G2-F24-P9` becomes ambiguous.

### What happens on merge

| Merge order        | Outcome                                                                                                                |
| :----------------- | :--------------------------------------------------------------------------------------------------------------------- |
| PR-A, then PR-B    | `version.json` conflicts, or PR-B lands a duplicate version. `version-policy` fails on `main` **after** the bad merge. |
| PR-B rebased first | Clean: PR-B rebases onto the new `main`, bumps to `G2-F24-P10`, and both versions are unique.                          |

The failure is always detected, but the base-branch comparison happens **after** the
merge is already on `main`. The `--against` check moves that detection to **PR time**,
before a human merges anything.

### Required procedure for parallel branches

When the version-policy check reports a collision, rebase and re-bump:

```bash
git fetch origin
git rebase origin/main
pnpm run version:bump patch|feature|generation   # now derives from the fresh main version
pnpm run version:check
git commit -am "chore(versioning): rebump to <new version>"
git push --force-with-lease
```

Rebasing (not merging) is preferred so the branch history stays linear and the
version bump commit sits directly on top of the rebased code.

### Merge-order rule

Because the version number is allocated by the contributor, **the last merge wins
the highest number**. Contributors must not assume their pre-assigned number
survives; the rebase-and-rebump step above is a normal part of landing a PR, not an
error condition.

---

## Feature Milestone Semantics

`F` is a **milestone counter**, not a feature list. `G2-F24-P10` means "Generation 2,
24 major feature milestones completed, 10 patches since milestone 24" — it does not
claim the codebase contains 24 features, and it does not enumerate them. A patch
sequence under an unchanged `F` means milestone 24 is still open and receiving fixes.

Because the counter alone is not self-describing, every **feature** bump (the ones
that advance `F`) MUST:

1. Add a `## [G<n>-F<m>-P0]` section to `CHANGELOG.md` whose notes name the
   milestone that `F` now represents.
2. Add a row for that milestone to the registry below.
3. State in the PR description which milestone the bump represents.

A **patch** bump (advancing only `P`) does not advance `F` and therefore requires no
new registry row.

### Milestone registry

Milestones are recorded here in ascending order. Milestones before the dated-version
migration (`G-F-P`, 2026-09-30) predate this file and are listed as unrecorded rather
than reconstructed — a guessed mapping would be worse than an acknowledged gap.

| Milestone | Name                                                      | Recorded         |
| :-------- | :-------------------------------------------------------- | :--------------- |
| F1–F23    | _pre-migration, not individually mapped_                  | No               |
| F24       | Dated `G-F-P` versioning, `version.json`, CI policy       | Yes — 2026-09-30 |
| F25       | Group Moderation System (Issue #46)                       | Yes — 2026-09-30 |
| F26       | Agent Engine Integration for Group Moderation (Issue #48) | Yes — 2026-10-01 |
| F27       | Dynamic Multi-Platform Downloader Suite (Issue #43)       | Yes — 2026-10-01 |
| F28       | External Status Channel Integration (Issue #47)           | Yes — 2026-10-02 |
| F29       | Cosmos MCP Server for AI Coding Agents (Issue #49)        | Yes — 2026-10-02 |
| F30       | MCP Alert Notifier (Discord/Slack/WhatsApp)               | Yes — 2026-10-03 |
| F31       | Command Background Remover (Issue #69)                    | Yes — 2026-10-04 |
| F32       | Progressive Disclosure UX (Issue #71)                     | Yes — 2026-10-05 |
| F33       | Channel ID Resolver `.check chid` (Issue #80)              | Yes — 2026-10-07 |
| F34       | _(open)_ — next completed feature milestone               | —                |

When a feature bump advances `F`, replace the open placeholder with the new
milestone and re-add the placeholder for the following number.

## Version Components

### Generation (G)

Indicates the generation or evolution of the system architecture.

**Format:** `G<number>`

**Examples:** `G1` · `G2` · `G3`

Increase the Generation when major changes occur, such as:

- Major refactoring.
- Changes to the project structure.
- Major database migration.
- Replacement of the main framework.
- System design changes that are incompatible with previous generations.

**Example**

```text
G1-F45-P12  →  G2-F1-P0
```

Because the system has entered a new generation.

### Feature Milestone (F)

Indicates the number of major feature milestones that have been completed.

**Format:** `F<number>`

**Examples:** `F1` · `F12` · `F24` · `F100`

Feature Milestones increase when a feature is considered complete and ready for use.
`F` is a **counter**, not an inventory: it states how many milestones shipped, not
what the codebase contains. See
[Feature Milestone Semantics](#feature-milestone-semantics) for the documentation
obligation attached to advancing `F`.

**Example milestones**

| Milestone | Feature              |
| --------- | -------------------- |
| F1        | Registration System  |
| F2        | Login System         |
| F3        | Dashboard            |
| F4        | Subscription System  |
| F5        | WhatsApp Integration |

**Example**

```text
G2-F24-P0  →  G2-F25-P0   (after adding a new feature)
```

### Patch (P)

Indicates the number of fixes since the last feature milestone.

**Format:** `P<number>`

**Examples:** `P0` · `P1` · `P2` · `P15`

A patch is added when:

- A bug is fixed.
- Validation is added.
- Optimization is performed.
- The UI is improved.
- Important documentation is updated.

**Example**

```text
G2-F24-P0  →  G2-F24-P1  →  G2-F24-P2   (bug fixes)
G2-F24-P2  →  G2-F25-P0                  (new feature added)
```

The patch resets to zero because the feature milestone has changed.

### Release Date (optional)

Indicates the date the version was released.

**Format:** `.<YYYY-MM-DD>`

**Examples:** `.2026-09-30` · `.2026-01-05` · `.2027-12-31`

Rules:

- Written in ISO 8601 format: 4-digit year, 2-digit month, 2-digit day.
- Attached directly to the patch number with a single dot (`.`), because the patch itself already uses a dash (`-`) as a separator.
- Optional — omit it when the exact release date is not significant (for example, internal builds or drafts).
- When the date is attached, the status suffix is placed after the date.

**Example**

```text
G1-F12-P2          →  G1-F12-P2.2026-09-30
G2-F24-P7-beta     →  G2-F24-P7.2026-09-30-beta
```

The date is not counted as a version increment; it only records when the version was released.

---

## Increment Rules

### New Patch

If only fixes are made:

```text
G2-F24-P3  →  G2-F24-P4
```

### New Feature

If the main feature is complete:

```text
G2-F24-P7  →  G2-F25-P0
```

### New Generation

If there is a major architectural change:

```text
G2-F40-P12  →  G3-F1-P0
```

---

## Release Examples

| Version                | Type                 | Meaning                                 |
| ---------------------- | -------------------- | --------------------------------------- |
| `G2-F24-P8`            | Bug Fix Release      | Bug fixes without new features.         |
| `G2-F25-P0`            | Feature Release      | A major new feature has been completed. |
| `G3-F1-P0`             | Architecture Release | A new system generation begins.         |
| `G1-F12-P2.2026-09-30` | Dated Release        | Patch 2, released on 2026-09-30.        |

---

## Development Stages (Optional)

A status can be added at the end of the version number.

```text
G2-F24-P7-alpha
G2-F24-P7-beta
G2-F24-P7-rc1
G2-F24-P7-stable
G2-F24-P7.2026-09-30-beta
```

| Status   | Meaning               |
| -------- | --------------------- |
| `alpha`  | Still experimental    |
| `beta`   | Ready for testing     |
| `rc`     | Release Candidate     |
| `stable` | Stable for production |

**Example:** `G2-F24-P7-beta`

The status always comes last. If a release date is present, the order is `G-F-P.date-status`.

---

## Examples

| Version                | Meaning                                               |
| ---------------------- | ----------------------------------------------------- |
| `G1-F1-P0`             | First feature of the first generation                 |
| `G1-F5-P3`             | 5 feature milestones, 3 patches                       |
| `G2-F1-P0`             | Start of the second generation                        |
| `G2-F24-P7`            | 24 feature milestones, 7 patches                      |
| `G3-F1-P0`             | Start of the third generation                         |
| `G1-F12-P2.2026-09-30` | 12 feature milestones, 2 patches, released 2026-09-30 |

---

## Philosophy

Version numbers should describe the product's evolution, not just the order of releases.

When looking at:

```text
G2-F24-P7
```

developers can immediately tell:

- The product is in Generation 2.
- It has 24 major feature milestones.
- It has received 7 patches since the last milestone.
- Optionally, when a date is attached (e.g. `G2-F24-P7.2026-09-30`), when it was released.

Without having to read the changelog first.
