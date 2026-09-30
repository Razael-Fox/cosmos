# Cosmos Versioning Specification

> Canonical specification for the Cosmos versioning format. `version.json` at the
> repository root is the machine-readable source of truth consumed by CI/CD and
> `src/utils/versioning.ts`. Human-readable guidance for AI Agents lives in
> `AGENTS.md` (Rule S) and `.agents/skills/cosmos-versioning/SKILL.md`.

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
