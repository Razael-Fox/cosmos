# HOW.md — Cosmos Version & Release Automation (Testing Team Guide)

This document explains how the automated versioning, tagging, and GitHub Release
pipeline works, what you should expect to see, and how to verify it is behaving
correctly. No bot commands or app features are involved — this is purely the
CI/CD machinery in `.github/workflows/`.

---

## 1. The Big Picture

Three GitHub Actions workflows cooperate:

```
Pull Request ──► version-policy.yml   (gatekeeper: "did you bump the version?")
                      │ merge / direct push
                      ▼
push to main ──► version-automation.yml
                      │  1. Decide: nothing / tag-only / bump (patch|feature|generation)
                      │  2. Bump version.json + package.json (+ CHANGELOG stub + registry row)
                      │  3. Commit [skip ci], push to main, push tag  G<x>-F<y>-P<z>
                      ▼
tag pushed ────► release.yml          (creates the GitHub Release with CHANGELOG notes)
              └► docker-publish.yml   (builds & pushes the GHCR Docker image)

push to main ──► format.yml           (runs Prettier over the whole codebase and pushes
                                       the result as github-actions[bot] with [skip ci])
```

`format.yml` and `version-automation.yml` are serialized through the `main-automation`
concurrency group so their bot commits cannot race. Local `pnpm format` is now optional —
CI fixes formatting for you — but running it still avoids a follow-up bot commit.

**The single source of truth for the version is `version.json`** in the repo root.
Everything else — `package.json`, Git tags, release titles — is derived from it.

---

## 2. The Version Format (quick reference)

`G<generation>-F<feature>-P<patch>` — e.g. `G2-F31-P11`.

| Component             | Meaning                               | When it goes up                  |
| :-------------------- | :------------------------------------ | :------------------------------- |
| `G` Generation        | Architecture era                      | Breaking / incompatible changes  |
| `F` Feature milestone | Count of completed feature milestones | A feature is finished and usable |
| `P` Patch             | Fixes since the last milestone        | Bug fixes, validation, UI, docs  |

Example: `G2-F31-P11` = Generation 2, 31 feature milestones completed, 11 patches
since milestone 31. `F` is a **counter**, not a list of features.

---

## 3. What Triggers What

### 3.1 On every Pull Request — `version-policy.yml`

- If the PR changes code (`src/`, `prisma/`, `scripts/`, `docker/`, workflows) it
  **must** also change `version.json`, and the new version must be **higher** than
  the base branch. Otherwise CI fails and the PR cannot merge cleanly.
- If two open PRs allocate the same version number, the one merged **second** must
  rebase and re-bump (the PR body will say so). This is expected, not a bug.

### 3.2 On every push to `main` — `version-automation.yml`

The job classifies the push into exactly one of three modes:

| Mode         | Condition                                                                            | Action                         |
| :----------- | :----------------------------------------------------------------------------------- | :----------------------------- |
| **nothing**  | The tag for the current `version.json` already exists, or no versioned paths changed | Exits silently                 |
| **tag-only** | The push itself changed `version.json` (a normal merged PR)                          | Tags HEAD with the new version |
| **bump**     | Code changed but `version.json` did **not** (e.g. a direct push)                     | Auto-bumps, commits, tags      |

In **bump** mode, the _kind_ of bump is inferred from the commit messages
(Conventional Commits):

| Commit message signal                        | Bump chosen  | Example result              |
| :------------------------------------------- | :----------- | :-------------------------- |
| `BREAKING CHANGE` footer, or `type!:` (bang) | `generation` | `G2-F40-P3` → `G3-F1-P0`    |
| Any `feat:` or `feat(scope):` subject        | `feature`    | `G2-F31-P11` → `G2-F32-P0`  |
| Anything else (`fix:`, `chore:`, `docs:`…)   | `patch`      | `G2-F31-P11` → `G2-F31-P12` |

When several commits land in one push, the **highest** severity wins
(generation > feature > patch).

In bump mode the bot (as `github-actions[bot]`) also:

1. Runs `pnpm run version:bump <kind>` + `version:check` (updates `version.json`
   and `package.json` together).
2. **Seeds a CHANGELOG.md section** titled `## [<new version>] - <date>` filled
   with the push's commit subjects (extraction, not authored prose).
3. **For feature bumps only**: replaces the `_(open)_` placeholder row in the
   milestone registry (`docs/VERSIONING.md`) with the new milestone and adds the
   next placeholder.
4. Commits with `[skip ci]` (so it does not retrigger itself) and pushes to `main`.
5. Pushes the version tag.

### 3.3 On every version tag — `release.yml` + `docker-publish.yml`

- `release.yml` validates the tag against `version.json`, **slices the matching
  `## [<version>]` section out of CHANGELOG.md**, and creates the GitHub Release
  with that text as the body. If no section exists (should not happen anymore),
  it falls back to GitHub's auto-generated notes with a warning.
- `docker-publish.yml` builds and pushes the `cosmos-origin` image to GHCR.

---

### How the chain actually fires (API, not git push)

Git pushes — even with a PAT — were observed **not** to start downstream
workflows, so `version-automation.yml` completes the chain itself through the
Actions API, which the default `GITHUB_TOKEN` may call:

1. `gh release create` with the CHANGELOG-extracted notes (skips if a
   tag-push already created the release).
2. `gh workflow run 'Publish Docker Image to GHCR'` — `docker-publish.yml`
   accepts a `workflow_dispatch` `tag` input, with a per-tag concurrency
   group so a stray PAT-triggered build and the API dispatch can't double-build.

The optional `RELEASE_TOKEN` PAT (if configured) is still used for the raw
`git push` of the tag, but the release and image no longer depend on it.

## 4. Manual Override (when the bot guesses wrong)

The classifier is only as honest as the commit messages. If a feature was
mis-typed as `fix:` and got a patch bump, a human can correct it:

1. Go to **Actions → Version Automation → Run workflow**.
2. Choose `patch`, `feature`, or `generation`.
3. The workflow bumps from the current `main`, seeds CHANGELOG notes from all
   commits since the last tag, and pushes the new tag.

---

## 5. What Testers Should Verify

After any push/merge to `main`:

1. **Tag appeared**: `git fetch --tags && git tag -l 'G*'` — the newest tag equals
   `version.json`'s `version` on `main`.
2. **Release appeared**: repo → Releases — title equals the tag, and the body
   contains the CHANGELOG section (not "auto-generated notes"), unless the
   fallback warning fired.
3. **Bot commits look right**: auto-bump commits are authored by
   `github-actions[bot]`, start with `chore(versioning): auto-bump`, contain
   `[skip ci]`, and touch only `version.json`, `package.json`, `CHANGELOG.md`,
   and (for features) `docs/VERSIONING.md`.
4. **Feature bumps registered**: `docs/VERSIONING.md` milestone registry has a
   real row for the new `F` number plus a fresh `_(open)_` placeholder.
5. **No loops**: exactly one auto-bump commit per eligible push; the workflow run
   following a bot commit exits as "nothing to do".

### Known edge cases (expected behavior, not bugs)

- **Two PRs allocate the same version** → the second one rebases and re-bumps;
  merge order decides the final number ("merge last, win highest").
- **A tag pushed manually** for a version that does not match `version.json` →
  `release.yml` fails on purpose (fail-closed). Fix the tag, don't bypass.
- **Mis-typed commit** (`fix:` that was really a feature) → wrong bump kind; use
  the manual override (§4) and note it in the PR review so commit hygiene improves.
- **Docs-only pushes** (`*.md`, `.agents/`) → no bump, no tag, no release. Intended.

---

## 6. Where to Look When Something Is Off

| Symptom                                                 | First place to check                                                                                                                       |
| :------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| Release has commit-list notes instead of CHANGELOG text | The `## [<version>]` section is missing/misnamed in CHANGELOG.md on the tagged commit                                                      |
| Auto-bump job failed at "push to main"                  | Branch protection on `main` is blocking the Actions token (needs push rights or a PAT)                                                     |
| Tag pushed but no Release / Docker build appeared       | Recursion guard: tags pushed with the default `GITHUB_TOKEN` never trigger other workflows — configure the `RELEASE_TOKEN` PAT secret (§4) |
| No tag after a PR merge                                 | `version-automation` run logs — likely "tag already exists" (fine) or a failed classify step                                               |
| Version number went backwards / duplicated              | `pnpm run version:verify -- --base <sha>` locally; see `docs/VERSIONING.md` → Parallel Branches                                            |

Full format specification: `docs/VERSIONING.md`. Agent-facing rules: `AGENTS.md` Rule S.
